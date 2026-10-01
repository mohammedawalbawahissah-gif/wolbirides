"""WR-26: errands and vendor orders go to the ops queue; parcels dispatch first and fall back to it."""
from unittest import mock

from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User
from core.models import Notification
from payments.models import Payment
from trips import services
from trips.models import ExternalCourier, Trip
from trips.tests import DispatchTestBase


class AdminDeliveryBase(DispatchTestBase):
    def setUp(self):
        super().setUp()
        cache.clear()
        for d in (self.driver_a, self.driver_b):
            d.accepts_deliveries = True
            d.save()
        self.admin = User.objects.create_user(phone="+233200000090", name="Ops", role="admin")
        self.support = User.objects.create_user(phone="+233200000091", name="Help", role="support")
        self.passenger_api = APIClient(); self.passenger_api.force_authenticate(self.passenger)
        self.staff = APIClient(); self.staff.force_authenticate(self.admin)
        self.scored = [(0.4, str(self.driver_a.user_id)), (1.2, str(self.driver_b.user_id))]

        async def fake_scored(zone_id, lat, lng, exclude_driver_ids=None):
            exclude = exclude_driver_ids or set()
            return [(d, u) for d, u in self.scored if u not in exclude]

        p = mock.patch("trips.services.scored_candidate_drivers", side_effect=fake_scored)
        p.start(); self.addCleanup(p.stop)
        p2 = mock.patch("accounts.services._send_sms")
        self.sms = p2.start(); self.addCleanup(p2.stop)

    def body(self, **extra):
        base = {"zone_id": str(self.zone.id), "pickup_lat": "9.400000", "pickup_lng": "-0.900000", "pickup_label": "Market",
                "destination_lat": "9.420000", "destination_lng": "-0.880000", "destination_label": "Hostel",
                "trip_type": "delivery", "no_prohibited_items": True}
        base.update(extra)
        return base

    def errand(self, **extra):
        r = self.passenger_api.post("/api/trips", self.body(delivery_subtype="errand", task_description="Buy kente, Stall 14",
                                                     sender_name="Auntie Ama", sender_phone="0243333333", **extra), format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return Trip.objects.get(id=r.data["id"])

    def parcel(self):
        r = self.passenger_api.post("/api/trips", self.body(delivery_subtype="parcel", recipient_name="Kofi", recipient_phone="0242222222",
                                                     package_description="Books"), format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return Trip.objects.get(id=r.data["id"])

    def queued_errand(self):
        trip = self.errand()
        self.assertEqual(trip.status, "awaiting_assignment")
        return trip


class RoutingTests(AdminDeliveryBase):
    def test_errand_and_vendor_order_wait_for_ops_and_are_never_offered_to_drivers(self):
        errand = self.errand()
        vendor = self.passenger_api.post("/api/trips", self.body(delivery_subtype="vendor_order", task_description="2x jollof",
                                                          vendor_name="Vero's", sender_name="Vero's"), format="json")
        for trip in (errand, Trip.objects.get(id=vendor.data["id"])):
            self.assertEqual(trip.status, "awaiting_assignment")
            self.assertFalse(trip.events.filter(event_type="offered_to_driver").exists())
            self.assertEqual(trip.events.get(event_type="sent_to_admin").payload["reason"], "review")

    def test_ops_and_the_passenger_are_told(self):
        trip = self.queued_errand()
        self.assertTrue(Notification.objects.filter(user=self.admin, title="Delivery needs a courier").exists())
        self.assertTrue(Notification.objects.filter(user=self.support, title="Delivery needs a courier").exists())
        self.assertTrue(Notification.objects.filter(user=self.passenger, title="We're arranging your delivery", link=f"/trip/{trip.id}").exists())

    def test_a_parcel_is_offered_to_drivers_first(self):
        trip = self.parcel()
        self.assertEqual(trip.status, "matching")
        self.assertTrue(trip.events.filter(event_type="offered_to_driver").exists())

    def test_a_parcel_nobody_takes_falls_back_to_ops_instead_of_no_drivers_found(self):
        self.scored = []
        trip = self.parcel()
        self.assertEqual(trip.status, "awaiting_assignment")
        self.assertEqual(trip.events.get(event_type="sent_to_admin").payload["reason"], "no_courier_accepted")
        self.assertEqual(trip.events.get(event_type="no_drivers_found").payload["reason"], "none_online")

    def test_a_ride_with_nobody_around_still_says_no_drivers_found(self):
        self.scored = []
        r = self.passenger_api.post("/api/trips", {**self.body(), "trip_type": "ride", "no_prohibited_items": False}, format="json")
        self.assertEqual(r.data["status"], "no_drivers_found")

    def test_the_queue_reason_reaches_the_passenger_app(self):
        trip = self.queued_errand()
        self.assertEqual(self.passenger_api.get(f"/api/trips/{trip.id}").data["queue_reason"], "review")

    def test_the_passenger_can_cancel_while_it_waits(self):
        trip = self.queued_errand()
        r = self.passenger_api.post(f"/api/trips/{trip.id}/cancel", {"reason": "Changed my mind"}, format="json")
        self.assertEqual(r.data["status"], "cancelled")


class DeskTests(AdminDeliveryBase):
    def test_only_staff_can_see_or_use_the_desk(self):
        trip = self.queued_errand()
        driver = APIClient(); driver.force_authenticate(self.driver_a.user)
        for client in (self.passenger_api, driver):
            self.assertEqual(client.get("/api/admin/deliveries").status_code, 403)
            self.assertEqual(client.post(f"/api/admin/deliveries/{trip.id}/assign", {"driver_id": str(self.driver_a.id)}, format="json").status_code, 403)
        support = APIClient(); support.force_authenticate(self.support)
        self.assertEqual(support.get("/api/admin/deliveries").status_code, 200)

    def test_queue_lists_waiting_deliveries_only(self):
        queued = self.queued_errand()
        self.passenger_api.post("/api/trips", {**self.body(), "trip_type": "ride", "no_prohibited_items": False}, format="json")
        ids = [t["id"] for t in self.staff.get("/api/admin/deliveries").data]
        self.assertEqual(ids, [str(queued.id)])

    def test_the_desk_never_receives_the_codes(self):
        self.queued_errand()
        d = self.staff.get("/api/admin/deliveries").data[0]["delivery"]
        self.assertIsNone(d["pickup_code"])
        self.assertIsNone(d["dropoff_code"])
        self.assertEqual(d["sender_name"], "Auntie Ama")

    def test_couriers_lists_only_free_verified_online_delivery_drivers_nearest_first(self):
        trip = self.queued_errand()
        self.driver_b.accepts_deliveries = False; self.driver_b.save()  # not taking deliveries
        rows = self.staff.get(f"/api/admin/deliveries/{trip.id}/couriers").data["drivers"]
        self.assertEqual([r["driver_id"] for r in rows], [str(self.driver_a.id)])
        self.assertEqual(rows[0]["distance_km"], 0.4)
        self.driver_b.accepts_deliveries = True; self.driver_b.save()
        rows = self.staff.get(f"/api/admin/deliveries/{trip.id}/couriers").data["drivers"]
        self.assertEqual([r["driver_id"] for r in rows], [str(self.driver_a.id), str(self.driver_b.id)])

    def test_the_queue_still_shows_a_delivery_that_is_out_for_offer(self):
        trip = self.queued_errand()
        self.staff.post(f"/api/admin/deliveries/{trip.id}/assign", {"driver_id": str(self.driver_a.id)}, format="json")
        rows = self.staff.get("/api/admin/deliveries").data
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["pending_offer"]["driver_name"], self.driver_a.user.name)

    def test_a_driver_already_on_a_trip_is_not_offered_to_ops(self):
        trip = self.queued_errand()
        other = self.parcel()
        services.accept_trip(other, self.driver_a)
        rows = self.staff.get(f"/api/admin/deliveries/{trip.id}/couriers").data["drivers"]
        self.assertEqual([r["driver_id"] for r in rows], [str(self.driver_b.id)])


class AssignmentTests(AdminDeliveryBase):
    def assign(self, trip, driver):
        return self.staff.post(f"/api/admin/deliveries/{trip.id}/assign", {"driver_id": str(driver.id)}, format="json")

    def accept_as(self, driver, trip):
        c = APIClient(); c.force_authenticate(driver.user)
        return c.post(f"/api/trips/{trip.id}/accept", format="json")

    def test_assigning_offers_it_rather_than_instantly_matching(self):
        """Ops picking a rider isn't the rider agreeing to it — it's an offer, same as organic
        dispatch, until they actually accept."""
        trip = self.queued_errand()
        r = self.assign(trip, self.driver_a)
        self.assertEqual(r.status_code, 200, r.data)
        trip.refresh_from_db()
        self.assertEqual((trip.status, trip.driver_id), ("matching", None))
        event = trip.events.get(event_type="offered_to_driver")
        self.assertEqual((event.payload["driver_id"], event.payload["admin_offer"], event.payload["admin_id"]),
                         (str(self.driver_a.user_id), True, str(self.admin.id)))
        self.assertTrue(Notification.objects.filter(user=self.driver_a.user, title="New delivery request").exists())
        self.assertFalse(Notification.objects.filter(user=self.passenger, title="Rider assigned").exists())

    def test_the_offer_appears_on_the_riders_own_offer_endpoint(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        data = c.get("/api/drivers/me/current-offer").data
        self.assertEqual(data["trip_id"], str(trip.id))
        self.assertTrue(data["admin_offer"])
        self.assertEqual(c.get("/api/drivers/me/current-offer").data["trip_id"], data["trip_id"])  # stable, repeatable read

    def test_accepting_matches_it_and_tells_the_passenger(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        r = self.accept_as(self.driver_a, trip)
        self.assertEqual(r.status_code, 200, r.data)
        trip.refresh_from_db()
        self.assertEqual((trip.status, trip.driver_id), ("matched", self.driver_a.id))
        self.assertTrue(Notification.objects.filter(user=self.passenger, title="Rider assigned").exists())

    def test_declining_sends_it_back_to_ops_not_to_other_drivers(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post(f"/api/trips/{trip.id}/decline", format="json")
        self.assertEqual(r.status_code, 200)
        trip.refresh_from_db()
        self.assertEqual(trip.status, "awaiting_assignment")
        self.assertIsNone(c.get("/api/drivers/me/current-offer").data)
        self.assertEqual(trip.events.filter(event_type="sent_to_admin").latest("created_at").payload["reason"], "driver_declined")

    def test_a_timed_out_offer_also_returns_it_to_ops(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        services.decline_or_timeout(Trip.objects.get(id=trip.id), str(self.driver_a.user_id))
        self.assertEqual(Trip.objects.get(id=trip.id).status, "awaiting_assignment")

    def test_an_accepted_driver_completes_it_like_any_delivery(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        self.accept_as(self.driver_a, trip)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        d = Trip.objects.get(id=trip.id).delivery
        self.assertEqual(c.post(f"/api/trips/{trip.id}/confirm-pickup", {"code": d.pickup_code}, format="json").data["status"], "in_progress")
        self.assertEqual(c.post(f"/api/trips/{trip.id}/confirm-dropoff", {"code": d.dropoff_code}, format="json").data["status"], "completed")

    def test_it_can_only_be_offered_once_and_only_to_someone_free_verified_and_not_already_offered(self):
        trip = self.queued_errand()
        self.assertEqual(self.assign(trip, self.driver_a).status_code, 200)
        self.assertEqual(self.assign(trip, self.driver_b).status_code, 409)  # no longer waiting
        second = self.queued_errand()
        self.assertEqual(self.assign(second, self.driver_a).status_code, 409)  # A already has an offer out
        third = self.queued_errand()
        self.driver_b.verification_status = "pending"; self.driver_b.save()
        self.assertEqual(self.assign(third, self.driver_b).status_code, 409)

    def test_a_driver_withdrawing_after_accepting_sends_it_back_to_ops_and_the_passenger_is_not_dumped(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        self.accept_as(self.driver_a, trip)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post(f"/api/trips/{trip.id}/cancel", {"reason": "Flat tyre"}, format="json")
        self.assertEqual(r.data["status"], "awaiting_assignment")
        trip.refresh_from_db()
        self.assertIsNone(trip.driver_id)
        self.assertEqual(trip.events.filter(event_type="sent_to_admin").latest("created_at").payload["reason"], "driver_withdrew")
        self.assertTrue(Notification.objects.filter(user=self.passenger, body__icontains="can't make it").exists())

    def test_ops_can_take_it_back_after_accept_but_before_pickup(self):
        trip = self.queued_errand()
        self.assign(trip, self.driver_a)
        self.accept_as(self.driver_a, trip)
        r = self.staff.post(f"/api/admin/deliveries/{trip.id}/unassign")
        self.assertEqual(r.data["status"], "awaiting_assignment")
        self.assertTrue(Notification.objects.filter(user=self.driver_a.user, title="Delivery reassigned").exists())

    def test_ops_can_cancel_and_it_is_recorded_as_them(self):
        trip = self.queued_errand()
        r = self.staff.post(f"/api/admin/deliveries/{trip.id}/cancel", {"reason": "Vendor closed"}, format="json")
        self.assertEqual(r.data["status"], "cancelled")
        trip.refresh_from_db()
        self.assertEqual(trip.cancelled_by, "admin")
        self.assertEqual(self.staff.post(f"/api/admin/deliveries/{trip.id}/cancel").status_code, 409)


class ExternalCourierTests(AdminDeliveryBase):
    def assign_external(self, trip, **body):
        return self.staff.post(f"/api/admin/deliveries/{trip.id}/assign-external", body, format="json")

    def test_assigning_a_new_external_courier_creates_and_reuses_them(self):
        trip = self.queued_errand()
        r = self.assign_external(trip, name="Musah", phone="0245555555")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "matched")
        self.assertIsNone(r.data["driver_detail"])
        self.assertEqual(r.data["delivery"]["external_courier"]["name"], "Musah")
        again = self.queued_errand()
        self.assign_external(again, name="Musah (again)", phone="0245555555")
        self.assertEqual(ExternalCourier.objects.count(), 1)

    def test_the_passenger_sees_who_is_coming(self):
        trip = self.queued_errand()
        self.assign_external(trip, name="Musah", phone="0245555555")
        data = self.passenger_api.get(f"/api/trips/{trip.id}").data
        self.assertEqual(data["delivery"]["external_courier"], {"id": ExternalCourier.objects.get().id, "name": "Musah", "phone": "+233245555555"})
        self.assertTrue(Notification.objects.filter(user=self.passenger, body__startswith="Musah").exists())

    def test_ops_record_pickup_and_dropoff_for_a_courier_with_no_app(self):
        trip = self.queued_errand()
        self.assign_external(trip, name="Musah", phone="0245555555")
        d = Trip.objects.get(id=trip.id).delivery
        url = f"/api/admin/deliveries/{trip.id}/"
        self.assertEqual(self.staff.post(url + "confirm-pickup", {"code": "0000"}, format="json").status_code, 400)
        self.assertEqual(self.staff.post(url + "confirm-pickup", {}, format="json").status_code, 400)
        self.assertEqual(self.staff.post(url + "confirm-dropoff", {"by_phone": True}, format="json").status_code, 409)  # not picked up yet
        self.assertEqual(self.staff.post(url + "confirm-pickup", {"code": d.pickup_code}, format="json").data["status"], "in_progress")
        self.assertEqual(self.staff.post(url + "confirm-dropoff", {"code": "0000"}, format="json").status_code, 400)
        done = self.staff.post(url + "confirm-dropoff", {"by_phone": True}, format="json")
        self.assertEqual(done.data["status"], "completed")
        ev = trip.events.get(event_type="delivery_dropped_off").payload
        self.assertEqual((ev["by"], ev["admin_id"]), ("admin_phone", str(self.admin.id)))

    def test_cash_paid_to_an_external_courier_is_recorded_by_ops(self):
        trip = self.queued_errand()
        self.assign_external(trip, name="Musah", phone="0245555555")
        url = f"/api/admin/deliveries/{trip.id}/"
        self.assertEqual(self.staff.post(url + "cash-received").status_code, 409)  # not complete yet
        self.staff.post(url + "confirm-pickup", {"by_phone": True}, format="json")
        self.staff.post(url + "confirm-dropoff", {"by_phone": True}, format="json")
        self.assertEqual(self.staff.post(url + "cash-received").status_code, 200)
        self.assertEqual(Payment.objects.get(trip=trip).confirmed_by, "admin")

    def test_ops_cannot_use_the_external_shortcuts_on_a_trip_with_a_driver(self):
        trip = self.queued_errand()
        self.staff.post(f"/api/admin/deliveries/{trip.id}/assign", {"driver_id": str(self.driver_a.id)}, format="json")
        self.assertEqual(self.staff.post(f"/api/admin/deliveries/{trip.id}/confirm-pickup", {"by_phone": True}, format="json").status_code, 409)
        self.assertEqual(self.staff.post(f"/api/admin/deliveries/{trip.id}/cash-received").status_code, 409)

    def test_a_courier_needs_a_name_and_phone(self):
        trip = self.queued_errand()
        self.assertEqual(self.assign_external(trip, name="Musah").status_code, 400)
