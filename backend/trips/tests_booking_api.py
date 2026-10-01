"""
Booking through the real HTTP endpoint, with exactly the payloads the apps send.
Covers: payment choice / preference chips never affect driver eligibility (a report
that couldn't be found by reading the matching code), and every delivery subtype
actually reaching the booking service (the view used to drop delivery_subtype).
"""
import itertools
from unittest import mock

from django.core.cache import cache

from rest_framework.test import APIClient

from trips.models import Trip
from trips.tests import DispatchTestBase

PREFS = ("prefer_previous_drivers", "quiet_ride", "needs_luggage_space", "needs_accessibility_help")


class BookingApiTests(DispatchTestBase):
    def setUp(self):
        super().setUp()
        self.c = APIClient()
        self.c.force_authenticate(self.passenger)
        # A driver who offers none of the optional services and has no gender set.
        self.driver_a.offers_quiet_ride = self.driver_a.has_luggage_space = self.driver_a.accessibility_trained = False
        self.driver_a.accepts_deliveries = True
        self.driver_a.save()
        self.driver_b.delete()

        async def scored(*a, **k):
            return [(0.4, str(self.driver_a.user_id))]

        p = mock.patch("trips.services.scored_candidate_drivers", side_effect=scored)
        p.start(); self.addCleanup(p.stop)

    def body(self, **extra):
        base = {
            "zone_id": str(self.zone.id),
            "pickup_lat": "9.400000", "pickup_lng": "-0.900000", "pickup_label": "Main gate",
            "destination_lat": "9.420000", "destination_lng": "-0.880000", "destination_label": "Hostel",
            "trip_type": "ride",
            "preferences": {"preferred_driver_gender": "", **{k: False for k in PREFS}},
        }
        base.update(extra)
        return base

    def test_any_payment_with_any_preference_subset_still_finds_the_driver(self):
        """The app always sends the whole preferences object. No combination may block dispatch."""
        subsets = [c for r in range(len(PREFS) + 1) for c in itertools.combinations(PREFS, r)]
        for payment in (None, "cash", "momo", "hubtel"):
            for subset in subsets:
                extra = {"preferences": {"preferred_driver_gender": "", **{k: k in subset for k in PREFS}}}
                if payment:
                    extra["payment_method"] = payment
                cache.clear()  # the per-hour booking limit is not what's under test
                r = self.c.post("/api/trips", self.body(**extra), format="json")
                self.assertEqual(r.status_code, 201, (payment, subset, r.data))
                self.assertEqual(r.data["status"], "matching", (payment, subset))
                Trip.objects.filter(id=r.data["id"]).update(status="cancelled")  # free the driver for the next case

    def test_delivery_with_any_payment_finds_an_opted_in_courier(self):
        for payment in (None, "cash", "momo", "hubtel"):
            extra = {"trip_type": "delivery", "delivery_subtype": "parcel", "no_prohibited_items": True,
                     "sender_name": "Ama", "sender_phone": "0241111111",
                     "recipient_name": "Kofi", "recipient_phone": "0242222222", "package_description": "Books"}
            if payment:
                extra["payment_method"] = payment
            cache.clear()
            r = self.c.post("/api/trips", self.body(**extra), format="json")
            self.assertEqual(r.status_code, 201, (payment, r.data))
            self.assertEqual(r.data["status"], "matching", payment)
            Trip.objects.filter(id=r.data["id"]).update(status="cancelled")

    def test_a_ride_with_nobody_available_says_why(self):
        self.driver_a.is_online = False
        self.driver_a.save()
        r = self.c.post("/api/trips", self.body(), format="json")
        self.assertEqual(r.data["status"], "no_drivers_found")
        self.assertEqual(r.data["no_drivers_reason"], "none_online")

    def test_a_parcel_no_driver_will_take_goes_to_ops_instead(self):
        self.driver_a.accepts_deliveries = False
        self.driver_a.save()
        r = self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="parcel", no_prohibited_items=True,
            recipient_name="Kofi", recipient_phone="0242222222", package_description="Books"), format="json")
        self.assertEqual(r.data["status"], "awaiting_assignment")
        self.assertEqual(r.data["queue_reason"], "no_courier_accepted")

    def test_delivery_subtype_reaches_the_service(self):
        errand = self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="errand", no_prohibited_items=True,
            task_description="Buy 2 yards of kente, Stall 14", spend_limit="150",
            sender_name="Auntie Ama", sender_phone="0243333333",
            recipient_name="Ama", recipient_phone="0241111111"), format="json")
        self.assertEqual(errand.status_code, 201, errand.data)
        self.assertEqual(errand.data["delivery"]["delivery_subtype"], "errand")
        self.assertEqual(errand.data["delivery"]["task_description"], "Buy 2 yards of kente, Stall 14")
        self.assertEqual(str(errand.data["delivery"]["spend_limit"]), "150.00")

        vendor = self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="vendor_order", no_prohibited_items=True,
            task_description="2x jollof", vendor_name="Vero's Kitchen", vendor_location="Stall 3", vendor_phone="0244444444",
            sender_name="Vero's Kitchen", sender_phone="0244444444",
            recipient_name="Ama", recipient_phone="0241111111"), format="json")
        self.assertEqual(vendor.status_code, 201, vendor.data)
        self.assertEqual(vendor.data["delivery"]["delivery_subtype"], "vendor_order")
        self.assertEqual(vendor.data["delivery"]["vendor"]["name"], "Vero's Kitchen")

    def test_the_offer_shows_the_job_but_never_sender_details_or_codes(self):
        """Errands are arranged by ops: a staff member offers it to the driver, who hasn't
        committed to it yet — no contact details or codes belong in an offer they might decline."""
        self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="errand", no_prohibited_items=True,
            task_description="Buy fabric", sender_name="Auntie Ama", sender_phone="0243333333"), format="json")
        trip = Trip.objects.latest("requested_at")
        d = APIClient(); d.force_authenticate(self.driver_a.user)
        from accounts.models import User
        from trips import services
        ops = User.objects.create_user(phone="+233200000099", name="Ops", role="admin")
        services.admin_offer_to_driver(Trip.objects.get(id=trip.id), self.driver_a, ops)
        offer = d.get("/api/drivers/me/current-offer").data
        self.assertEqual(offer["trip_id"], str(trip.id))
        self.assertEqual(offer["task_description"], "Buy fabric")
        self.assertNotIn("sender_name", offer)
        self.assertNotIn("sender_phone", offer)

    def test_once_accepted_the_driver_sees_sender_details_but_never_the_codes(self):
        self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="errand", no_prohibited_items=True,
            task_description="Buy fabric", sender_name="Auntie Ama", sender_phone="0243333333"), format="json")
        trip = Trip.objects.latest("requested_at")
        d = APIClient(); d.force_authenticate(self.driver_a.user)
        from accounts.models import User
        from trips import services
        ops = User.objects.create_user(phone="+233200000099", name="Ops", role="admin")
        services.admin_offer_to_driver(Trip.objects.get(id=trip.id), self.driver_a, ops)
        d.post(f"/api/trips/{trip.id}/accept", format="json")
        data = d.get(f"/api/trips/{trip.id}").data["delivery"]
        self.assertEqual((data["sender_name"], data["sender_phone"]), ("Auntie Ama", "+233243333333"))
        self.assertEqual(data["task_description"], "Buy fabric")
        self.assertIsNone(data["pickup_code"])
        self.assertIsNone(data["dropoff_code"])


class WhoCanBookTests(BookingApiTests):
    """Bookings (rides, errands, parcels...) are made from passenger accounts only."""

    def test_a_driver_cannot_book_an_errand_to_send_to_themselves(self):
        self.c.force_authenticate(self.driver_a.user)
        r = self.c.post("/api/trips", self.body(
            trip_type="delivery", delivery_subtype="errand", no_prohibited_items=True,
            task_description="Buy fabric", sender_name="Stall 14"), format="json")
        self.assertEqual(r.status_code, 403)
        self.assertIn("passenger", r.data["detail"])
        self.assertFalse(Trip.objects.exists())

    def test_ops_accounts_cannot_book_either(self):
        from accounts.models import User

        for role in ("admin", "support"):
            staff = User.objects.create_user(phone=f"+2332000009{role[0] == 'a' and '1' or '2'}", name=role, role=role)
            self.c.force_authenticate(staff)
            self.assertEqual(self.c.post("/api/trips", self.body(), format="json").status_code, 403)

    def test_a_passenger_still_can(self):
        self.assertEqual(self.c.post("/api/trips", self.body(), format="json").status_code, 201)
