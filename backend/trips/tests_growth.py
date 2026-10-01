"""Growth PRD WR-19 to WR-24 (and the WR-18/WR-16 additions), checked against the PRD's requirements and guardrails."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from bundles.models import BundlePlan, PassengerBundle
from bundles.services import BundleError, activate, start_purchase
from incidents.models import Incident
from organizations.models import Organization, OrganizationMember
from organizations.services import (
    OrganizationBillingError, generate_invoice, issue_vouchers, redeem_voucher, top_up,
)
from partners.models import Partner, PromoCode, PromoRedemption, SponsoredPlacement
from partners.services import PromoError
from payments.models import Payment
from payments.services import generate_weekly_payouts
from trips import services
from trips.models import DeliveryDetail, Trip, TripPreference, Vendor
from trips.tests import DispatchTestBase

PICKUP = {"lat": Decimal("9.400000"), "lng": Decimal("-0.900000"), "label": "Main gate"}
DEST = {"lat": Decimal("9.420000"), "lng": Decimal("-0.880000"), "label": "Hostel"}


def _complete(trip, driver):
    services.accept_trip(trip, driver)
    services.start_trip(Trip.objects.get(id=trip.id))
    return services.complete_trip(Trip.objects.get(id=trip.id))


class PreferenceTests(DispatchTestBase):
    """WR-19."""

    def setUp(self):
        super().setUp()
        self.driver_a.gender = "male"; self.driver_a.save()
        self.driver_b.gender = "female"; self.driver_b.save()

    def _scored(self):
        return [(0.5, str(self.driver_a.user_id)), (2.5, str(self.driver_b.user_id))]

    def test_gender_preference_offers_matching_driver_even_if_further(self):
        trip = self._request_trip_scored(self._scored(), options={"preferences": {"preferred_driver_gender": "female"}})
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))

    def test_no_matching_driver_asks_passenger_never_silently_reassigns(self):
        self.driver_b.gender = ""; self.driver_b.save()
        trip = self._request_trip_scored(self._scored(), options={"preferences": {"preferred_driver_gender": "female"}})
        trip.refresh_from_db()
        self.assertEqual(trip.status, Trip.Status.MATCHING)
        self.assertEqual(trip.preference_status, Trip.PreferenceStatus.AWAITING_PASSENGER)
        self.assertIsNone(services.current_offered_driver_id(trip))
        self.assertTrue(self.passenger.notifications.filter(title__icontains="No matching rider").exists())

    def test_passenger_chooses_any_driver(self):
        self.driver_b.gender = ""; self.driver_b.save()
        trip = self._request_trip_scored(self._scored(), options={"preferences": {"preferred_driver_gender": "female"}})
        c = APIClient(); c.force_authenticate(self.passenger)
        r = c.post(f"/api/trips/{trip.id}/preference-decision", {"decision": "any_driver"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_a.user_id))

    def test_passenger_chooses_to_keep_waiting(self):
        self.driver_b.gender = ""; self.driver_b.save()
        trip = self._request_trip_scored(self._scored(), options={"preferences": {"preferred_driver_gender": "female"}})
        with mock.patch("trips.tasks.retry_preference_dispatch.apply_async") as retry:
            services.preference_decision(Trip.objects.get(id=trip.id), "keep_waiting")
        retry.assert_called_once()
        self.assertIsNone(services.current_offered_driver_id(trip))

    def test_prefer_previous_driver_ranks_them_first_among_equally_close(self):
        _complete(self._request_trip_offered_to(self.driver_b), self.driver_b)
        TripPreference.objects.create(user=self.passenger, prefer_previous_drivers=True)
        trip = self._request_trip_scored([(1.0, str(self.driver_a.user_id)), (1.3, str(self.driver_b.user_id))])
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))

    def test_drivers_never_see_preferences(self):
        trip = self._request_trip_scored(self._scored(), options={"preferences": {"preferred_driver_gender": "female"}})
        services.accept_trip(trip, self.driver_b)
        c = APIClient(); c.force_authenticate(self.driver_b.user)
        data = c.get(f"/api/trips/{trip.id}").data
        self.assertIsNone(data["preferences"])
        c.force_authenticate(self.passenger)
        self.assertEqual(c.get(f"/api/trips/{trip.id}").data["preferences"]["preferred_driver_gender"], "female")

    def test_offer_payload_has_no_preferences(self):
        with mock.patch("trips.services.async_to_sync") as a2s:
            captured = []
            a2s.side_effect = lambda fn: (lambda *args, **kw: captured.append(args) or
                                          ([(0.5, str(self.driver_b.user_id))] if "scored" in getattr(fn, "__name__", "") else None))
            trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST,
                                         options={"preferences": {"quiet_ride": True}})
            services.start_dispatch_cascade(trip)
        offers = [a for a in captured if len(a) == 2 and isinstance(a[1], dict) and a[1].get("type") == "ride_request"]
        self.assertTrue(offers)
        self.assertNotIn("preferences", offers[0][1]["trip"])


@override_settings(FAIR_QUEUE_SHARE=0.15)
class FairQueueTests(DispatchTestBase):
    """WR-20: a floor on a share of dispatches, not a replacement for nearest-first."""

    def setUp(self):
        super().setUp()
        _complete(self._request_trip_offered_to(self.driver_a), self.driver_a)  # driver_a busier this week

    def test_most_dispatches_stay_nearest_first(self):
        with mock.patch("trips.services._fairness_draw", return_value=0.99):
            trip = self._request_trip_scored([(1.0, str(self.driver_a.user_id)), (1.2, str(self.driver_b.user_id))])
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_a.user_id))

    def test_fairness_floor_favours_fewer_recent_trips_and_logs_cost(self):
        with mock.patch("trips.services._fairness_draw", return_value=0.01):
            trip = self._request_trip_scored([(1.0, str(self.driver_a.user_id)), (1.2, str(self.driver_b.user_id))])
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))
        offer = trip.events.filter(event_type="offered_to_driver").last().payload
        self.assertTrue(offer["fair_queue"])
        self.assertAlmostEqual(offer["extra_km"], 0.2, places=3)

    def test_fairness_never_goes_beyond_the_eta_band(self):
        with mock.patch("trips.services._fairness_draw", return_value=0.01):
            trip = self._request_trip_scored([(0.5, str(self.driver_a.user_id)), (3.0, str(self.driver_b.user_id))])
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_a.user_id))

    def test_report_has_prd_metrics(self):
        admin = User.objects.create_user(phone="+233200000099", role="admin")
        c = APIClient(); c.force_authenticate(admin)
        s = c.get("/api/admin/dispatch/fairness?days=7").data["summary"]
        for key in ("gini", "p90_p10_ratio", "fair_queue_offers", "fair_queue_avg_extra_km"):
            self.assertIn(key, s)


class OrganizationTests(DispatchTestBase):
    """WR-21: accounts, prepaid balances, vouchers, funding_source."""

    def setUp(self):
        super().setUp()
        self.org = Organization.objects.create(name="UDS Dept of Nursing", monthly_budget=Decimal("100.00"))
        self.member = OrganizationMember.objects.create(organization=self.org, user=self.passenger,
                                                        monthly_limit=Decimal("30.00"))

    def _org_trip(self, **extra):
        return self._request_trip_scored([(1.0, str(self.driver_a.user_id))], options={
            "payment_method": "organization", "organization_id": self.org.id, **extra})

    def test_member_trip_records_funding_source_and_is_paid_out(self):
        trip = _complete(self._org_trip(), self.driver_a)
        p = Payment.objects.get(trip=trip)
        self.assertEqual(p.funding_source, "organization_account")
        today = timezone.localdate()
        self.assertEqual(len(generate_weekly_payouts(today - timedelta(days=1), today + timedelta(days=1))[0].line_items), 1)

    def test_member_limit_enforced(self):
        self.member.monthly_limit = Decimal("1.00"); self.member.save()
        with self.assertRaises(OrganizationBillingError):
            self._org_trip()
        self.assertFalse(Trip.objects.exists())

    def test_prepaid_balance_blocks_overspend_and_is_drawn_down(self):
        self.org.prepaid_balance = Decimal("1.00"); self.org.save()
        with self.assertRaises(OrganizationBillingError):
            self._org_trip()
        top_up(self.org, "50.00", "MoMo ref 123")
        trip = _complete(self._org_trip(), self.driver_a)
        self.org.refresh_from_db()
        self.assertEqual(self.org.prepaid_balance, Decimal("51.00") - trip.fare_final)
        self.assertEqual(self.org.balance_entries.count(), 2)

    def test_ride_voucher_flow(self):
        voucher = issue_vouchers(self.org, 1, "rides", ride_count=1)[0]
        stranger = User.objects.create_user(phone="+233200000050", role="passenger")
        c = APIClient(); c.force_authenticate(stranger)
        self.assertEqual(c.post("/api/vouchers/redeem", {"code": voucher.code.lower()}, format="json").status_code, 200)
        c.force_authenticate(self.passenger)
        self.assertEqual(c.post("/api/vouchers/redeem", {"code": voucher.code}, format="json").status_code, 400)
        trip = services.request_trip(stranger, self.zone, PICKUP, DEST,
                                     options={"payment_method": "voucher", "voucher_id": voucher.id})
        self.assertEqual(trip.organization_id, self.org.id)
        voucher.refresh_from_db()
        self.assertEqual(voucher.rides_remaining, 0)
        services.cancel_trip(trip, "passenger")
        voucher.refresh_from_db()
        self.assertEqual(voucher.rides_remaining, 1)

    def test_value_voucher_rejects_trip_it_cannot_cover(self):
        voucher = issue_vouchers(self.org, 1, "value", value=Decimal("1.00"))[0]
        redeem_voucher(self.passenger, voucher.code)
        with self.assertRaises(OrganizationBillingError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST,
                                  options={"payment_method": "voucher", "voucher_id": voucher.id})

    def test_voucher_trip_funding_source_and_invoice(self):
        voucher = issue_vouchers(self.org, 1, "value", value=Decimal("100.00"))[0]
        redeem_voucher(self.passenger, voucher.code)
        trip = self._request_trip_scored([(1.0, str(self.driver_a.user_id))],
                                         options={"payment_method": "voucher", "voucher_id": voucher.id})
        trip = _complete(trip, self.driver_a)
        self.assertEqual(Payment.objects.get(trip=trip).funding_source, "organization_voucher")
        voucher.refresh_from_db()
        self.assertEqual(voucher.value_remaining, Decimal("100.00") - trip.fare_final)
        today = timezone.localdate()
        inv = generate_invoice(self.org, today.replace(day=1), today + timedelta(days=1))
        self.assertEqual(inv.line_items[0]["paid_with"], "voucher")
        # The person who booked is a passenger ("rider" is the person carrying the job), so statements say so.
        self.assertEqual(inv.line_items[0]["passenger"], self.passenger.name or self.passenger.phone)
        self.assertNotIn("rider", inv.line_items[0])


class BundleTests(DispatchTestBase):
    """WR-22."""

    def setUp(self):
        super().setUp()
        self.plan = BundlePlan.objects.create(name="Campus 10", ride_count=2, price=Decimal("20.00"),
                                              max_fare_per_ride=Decimal("15.00"))
        self.bundle = activate(start_purchase(self.passenger, self.plan))

    def test_bundle_is_used_automatically_without_choosing_it(self):
        trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST)
        self.assertEqual(trip.payment_method, "bundle")
        self.bundle.refresh_from_db()
        self.assertEqual(self.bundle.rides_remaining, 1)

    def test_oldest_bundle_used_first(self):
        newer = activate(start_purchase(self.passenger, self.plan))
        PassengerBundle.objects.filter(id=newer.id).update(activated_at=timezone.now() + timedelta(minutes=1))
        trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST)
        self.assertEqual(trip.bundle_id, self.bundle.id)

    def test_falls_back_to_per_trip_payment_when_bundle_cannot_cover(self):
        self.bundle.max_fare_per_ride = Decimal("1.00"); self.bundle.save()
        trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST)
        self.assertEqual(trip.payment_method, "cash")

    def test_explicit_cash_is_respected(self):
        trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={"payment_method": "cash"})
        self.assertEqual(trip.payment_method, "cash")

    def test_default_plan_never_expires(self):
        self.assertIsNone(self.bundle.expires_at)

    @override_settings(BUNDLE_MIN_TERM_DAYS=120)
    def test_short_expiry_must_be_acknowledged(self):
        short = BundlePlan.objects.create(name="Exam week", ride_count=5, price=Decimal("30"),
                                          max_fare_per_ride=Decimal("15"), valid_days=14)
        with self.assertRaises(BundleError):
            start_purchase(self.passenger, short)
        b = start_purchase(self.passenger, short, acknowledged_short_expiry=True)
        self.assertTrue(b.short_expiry_acknowledged)
        c = APIClient(); c.force_authenticate(self.passenger)
        r = c.post("/api/ride-bundles/purchase", {"plan_id": str(short.id), "payment_method": "office"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(r.data["requires_expiry_acknowledgement"])

    def test_bundle_trip_paid_out_as_ride_bundle(self):
        trip = self._request_trip_scored([(1.0, str(self.driver_a.user_id))])
        trip = _complete(trip, self.driver_a)
        self.assertEqual(Payment.objects.get(trip=trip).funding_source, "ride_bundle")


class DeliveryTests(DispatchTestBase):
    """WR-23: DeliveryDetail, separate pickup/drop-off confirmations."""

    def setUp(self):
        super().setUp()
        self.driver_b.accepts_deliveries = True; self.driver_b.save()
        self.opts = {"trip_type": "delivery", "recipient_name": "Kofi", "recipient_phone": "0241234567",
                     "package_description": "Lab textbook", "package_size": "medium"}

    def _delivery(self):
        with mock.patch("accounts.services._send_sms") as sms, self.captureOnCommitCallbacks(execute=True):
            trip = self._request_trip_scored([(0.5, str(self.driver_a.user_id)), (2.5, str(self.driver_b.user_id))],
                                             options=self.opts)
        return trip, sms

    def test_only_opted_in_drivers_and_recipient_gets_dropoff_code(self):
        trip, sms = self._delivery()
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))
        self.assertEqual(trip.delivery.package_size, "medium")
        self.assertIn(trip.delivery.dropoff_code, sms.call_args[0][1])
        self.assertNotIn(trip.delivery.pickup_code, sms.call_args[0][1])

    def test_sending_a_parcel_defaults_the_sender_to_the_booker_and_texts_only_the_recipient(self):
        trip, sms = self._delivery()
        self.assertEqual(trip.delivery.sender_name, "Ama")
        self.assertEqual(trip.delivery.sender_phone, "+233200000001")
        self.assertEqual(sms.call_count, 1)
        self.assertEqual(sms.call_args[0][0], "+233241234567")

    def test_receiving_a_parcel_requires_a_sender_and_texts_them_the_pickup_code(self):
        receiving = {**self.opts, "recipient_name": "Ama", "recipient_phone": "0200000001"}
        with self.assertRaises(services.TripRequestError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options=receiving)
        self.opts = {**receiving, "sender_name": "Kofi", "sender_phone": "0241234567"}
        trip, sms = self._delivery()
        self.assertEqual(sms.call_count, 1)  # only the sender: the booker is the recipient
        self.assertEqual(sms.call_args[0][0], "+233241234567")
        self.assertIn(trip.delivery.pickup_code, sms.call_args[0][1])
        self.assertNotIn(trip.delivery.dropoff_code, sms.call_args[0][1])

    def test_full_delivery_lifecycle_with_both_confirmations(self):
        trip, _ = self._delivery()
        services.accept_trip(trip, self.driver_b)
        c = APIClient(); c.force_authenticate(self.driver_b.user)
        self.assertEqual(c.post(f"/api/trips/{trip.id}/start").status_code, 409)  # not the ride lifecycle
        self.assertEqual(c.post(f"/api/trips/{trip.id}/confirm-pickup", {"code": "xxxx"}).status_code, 400)
        r = c.post(f"/api/trips/{trip.id}/confirm-pickup", {"code": trip.delivery.pickup_code})
        self.assertEqual(r.data["status"], "in_progress")
        self.assertEqual(c.post(f"/api/trips/{trip.id}/confirm-dropoff", {"code": "xxxx"}).status_code, 400)
        r = c.post(f"/api/trips/{trip.id}/confirm-dropoff", {"code": trip.delivery.dropoff_code})
        self.assertEqual(r.data["status"], "completed")

    def test_pickup_can_be_confirmed_with_a_photo(self):
        trip, _ = self._delivery()
        services.accept_trip(trip, self.driver_b)
        services.confirm_pickup(Trip.objects.get(id=trip.id), photo_url="https://res.cloudinary.com/x/pkg.jpg")
        trip.refresh_from_db()
        self.assertEqual(trip.status, Trip.Status.IN_PROGRESS)

    def test_driver_never_sees_either_code(self):
        trip, _ = self._delivery()
        services.accept_trip(trip, self.driver_b)
        c = APIClient(); c.force_authenticate(self.driver_b.user)
        d = c.get(f"/api/trips/{trip.id}").data["delivery"]
        self.assertIsNone(d["pickup_code"]); self.assertIsNone(d["dropoff_code"])
        c.force_authenticate(self.passenger)
        self.assertEqual(c.get(f"/api/trips/{trip.id}").data["delivery"]["pickup_code"], trip.delivery.pickup_code)

    def test_missing_recipient_rejected(self):
        with self.assertRaises(services.TripRequestError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={"trip_type": "delivery"})


class DeliverySizeSurchargeTests(DispatchTestBase):
    """WR-25: parcel surcharge scales with package_size instead of one flat amount."""

    def setUp(self):
        super().setUp()
        self.driver_b.accepts_deliveries = True; self.driver_b.save()

    def _quote_for(self, size):
        with mock.patch("accounts.services._send_sms"), self.captureOnCommitCallbacks(execute=True):
            trip = self._request_trip_scored(
                [(0.5, str(self.driver_a.user_id)), (2.5, str(self.driver_b.user_id))],
                options={"trip_type": "delivery", "recipient_name": "Kofi", "recipient_phone": "0241234567",
                         "package_description": "Item", "package_size": size},
            )
        return trip.fare_quote.surcharge

    def test_surcharge_increases_with_package_size(self):
        small, medium, large = self._quote_for("small"), self._quote_for("medium"), self._quote_for("large")
        self.assertLess(small, medium)
        self.assertLess(medium, large)


class ErrandAndVendorOrderTests(DispatchTestBase):
    """WR-25: errand-running and vendor-order deliveries share DeliveryDetail/Trip.Kind.DELIVERY
    with parcels, but skip the third-party-recipient requirement and notification."""

    def setUp(self):
        super().setUp()
        self.driver_b.accepts_deliveries = True; self.driver_b.save()

    def _request(self, options, sms_mock=None):
        ctx = mock.patch("accounts.services._send_sms") if sms_mock is None else sms_mock
        with ctx as sms, self.captureOnCommitCallbacks(execute=True):
            trip = self._request_trip_scored(
                [(0.5, str(self.driver_a.user_id)), (2.5, str(self.driver_b.user_id))], options=options,
            )
        return trip, sms

    def test_errand_needs_a_task_and_a_contact_at_pickup(self):
        with self.assertRaises(services.TripRequestError):  # no task
            services.request_trip(self.passenger, self.zone, PICKUP, DEST,
                                   options={"trip_type": "delivery", "delivery_subtype": "errand", "sender_name": "Auntie Ama"})
        with self.assertRaises(services.TripRequestError):  # nobody to collect from
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={
                "trip_type": "delivery", "delivery_subtype": "errand", "task_description": "Buy fabric"})
        trip, _ = self._request({"trip_type": "delivery", "delivery_subtype": "errand",
                                 "task_description": "Buy 2 yards of kente from Stall 14, Aboabo",
                                 "sender_name": "Auntie Ama, Stall 14", "spend_limit": "150.00"})
        self.assertEqual(trip.delivery.delivery_subtype, DeliveryDetail.Subtype.ERRAND)
        self.assertEqual(trip.delivery.sender_name, "Auntie Ama, Stall 14")
        # It comes back to the requester, so the recipient defaults to them.
        self.assertEqual(trip.delivery.recipient_name, "Ama")
        self.assertEqual(trip.delivery.recipient_phone, "+233200000001")
        self.assertEqual(str(trip.delivery.spend_limit), "150.00")

    def test_errand_texts_nobody_when_the_requester_is_the_recipient_and_there_is_no_sender_phone(self):
        trip, sms = self._request({"trip_type": "delivery", "delivery_subtype": "errand",
                                   "task_description": "Buy fabric", "sender_name": "Stall 14"})
        sms.assert_not_called()

    def test_errand_sender_with_a_phone_gets_the_pickup_code(self):
        trip, sms = self._request({"trip_type": "delivery", "delivery_subtype": "errand",
                                   "task_description": "Buy fabric", "sender_name": "Auntie Ama",
                                   "sender_phone": "0243333333"})
        sms.assert_called_once()
        self.assertEqual(sms.call_args[0][0], "+233243333333")
        self.assertIn(trip.delivery.pickup_code, sms.call_args[0][1])
        self.assertNotIn(trip.delivery.dropoff_code, sms.call_args[0][1])

    def test_vendor_order_sender_defaults_to_the_vendor(self):
        trip, sms = self._request({"trip_type": "delivery", "delivery_subtype": "vendor_order",
                                   "task_description": "2x jollof", "vendor_name": "Vero's Kitchen",
                                   "vendor_phone": "0244444444"})
        self.assertEqual(trip.delivery.sender_name, "Vero's Kitchen")
        self.assertEqual(trip.delivery.sender_phone, "+233244444444")
        self.assertEqual(trip.delivery.recipient_name, "Ama")
        self.assertEqual(sms.call_count, 1)  # the vendor gets the pickup code; the requester sees theirs in-app
        self.assertIn(trip.delivery.pickup_code, sms.call_args[0][1])

    def test_vendor_order_creates_vendor_and_is_reused_case_insensitively(self):
        trip, _ = self._request({"trip_type": "delivery", "delivery_subtype": "vendor_order",
                                 "task_description": "2x jollof, no salad",
                                 "vendor_name": "Vero's Kitchen", "vendor_location": "Behind GNPC"})
        self.assertEqual(Vendor.objects.count(), 1)
        self.assertEqual(trip.delivery.vendor.location_label, "Behind GNPC")

        trip2, _ = self._request({"trip_type": "delivery", "delivery_subtype": "vendor_order",
                                  "task_description": "1x banku and okro",
                                  "vendor_name": "vero's kitchen"})
        self.assertEqual(Vendor.objects.count(), 1)  # same vendor, different casing
        self.assertEqual(trip2.delivery.vendor_id, trip.delivery.vendor_id)

    def test_vendor_order_requires_a_vendor_name_or_id(self):
        with self.assertRaises(services.TripRequestError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={
                "trip_type": "delivery", "delivery_subtype": "vendor_order", "task_description": "Order food",
            })

    def test_vendor_order_can_reference_an_existing_vendor_by_id(self):
        vendor = Vendor.objects.create(name="Tamale Fresh Mart", location_label="Aboabo market")
        trip, _ = self._request({"trip_type": "delivery", "delivery_subtype": "vendor_order",
                                 "task_description": "Rice and oil", "vendor_id": str(vendor.id)})
        self.assertEqual(trip.delivery.vendor_id, vendor.id)
        self.assertEqual(Vendor.objects.count(), 1)

    def test_unknown_delivery_subtype_rejected(self):
        with self.assertRaises(services.TripRequestError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={
                "trip_type": "delivery", "delivery_subtype": "not_a_real_subtype", "task_description": "x",
            })


class PartnerTests(DispatchTestBase):
    """WR-24: labelled, zone-level placements; promo codes."""

    def setUp(self):
        super().setUp()
        self.partner = Partner.objects.create(name="Mama's Waakye", zone=self.zone, lat=DEST["lat"], lng=DEST["lng"])
        now = timezone.now()
        SponsoredPlacement.objects.create(zone=self.zone, partner=self.partner, title="Lunch near the library",
                                          sponsor_name="Mama's Waakye", active_from=now - timedelta(days=1),
                                          active_to=now + timedelta(days=1), price_paid=Decimal("200"))
        SponsoredPlacement.objects.create(zone=self.zone, title="Old promo", sponsor_name="X",
                                          active_from=now - timedelta(days=9), active_to=now - timedelta(days=2))

    def test_placements_are_labelled_identical_for_everyone_and_hide_price(self):
        other = User.objects.create_user(phone="+233200000077", role="passenger")
        results = []
        for u in (self.passenger, other):
            c = APIClient(); c.force_authenticate(u)
            results.append(c.get(f"/api/placements/active?zone_id={self.zone.id}").data)
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(results[0]), 1)
        self.assertTrue(results[0][0]["sponsored"])
        self.assertNotIn("price_paid", results[0][0])

    def test_promo_discount_and_single_use(self):
        PromoCode.objects.create(code="waakye10", partner=self.partner, discount_type="percent", value=Decimal("10"))
        trip = services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={"promo_code": "WAAKYE10"})
        self.assertGreater(trip.fare_quote.discount, 0)
        with self.assertRaises(PromoError):
            services.request_trip(self.passenger, self.zone, PICKUP, DEST, options={"promo_code": "WAAKYE10"})
        services.cancel_trip(Trip.objects.get(id=trip.id), "passenger")
        self.assertEqual(PromoRedemption.objects.get().status, "void")


class SafetyAdditionsTests(DispatchTestBase):
    """WR-18 items from the PRD."""

    def setUp(self):
        super().setUp()
        self.trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(self.trip, self.driver_a)

    @mock.patch("accounts.services._send_sms")
    def test_sos_alerts_zone_security_contact(self, sms):
        self.zone.security_contact_phone = "+233300000000"; self.zone.save()
        c = APIClient(); c.force_authenticate(self.passenger)
        c.post(f"/api/trips/{self.trip.id}/sos", {}, format="json")
        self.assertIn("+233300000000", [call.args[0] for call in sms.call_args_list])

    def test_post_trip_checkin_feeds_incidents_and_is_separate_from_rating(self):
        services.start_trip(Trip.objects.get(id=self.trip.id))
        services.complete_trip(Trip.objects.get(id=self.trip.id))
        c = APIClient(); c.force_authenticate(self.passenger)
        r = c.post(f"/api/trips/{self.trip.id}/checkin", {"response": "something_off", "details": "Took a strange route"},
                   format="json")
        incident = Incident.objects.get(id=r.data["incident_id"])
        self.assertEqual(incident.trigger_source, "post_trip_checkin")
        self.driver_a.refresh_from_db()
        self.assertEqual(self.driver_a.verification_status, "verified")  # no auto-suspension from one answer
        c.force_authenticate(self.driver_a.user)
        r = c.post(f"/api/trips/{self.trip.id}/checkin", {"response": "fine"}, format="json")
        self.assertIsNone(r.data["incident_id"])

    def test_checkin_only_after_completion(self):
        c = APIClient(); c.force_authenticate(self.passenger)
        self.assertEqual(c.post(f"/api/trips/{self.trip.id}/checkin", {"response": "fine"}, format="json").status_code, 409)

    def test_share_link_marks_trip_shared_and_prd_path_works(self):
        c = APIClient(); c.force_authenticate(self.passenger)
        self.assertEqual(c.post(f"/api/trips/{self.trip.id}/share-link").status_code, 201)
        self.trip.refresh_from_db()
        self.assertTrue(self.trip.shared_with_contact)


class TrustIndicatorTests(DispatchTestBase):
    def test_endpoint_reports_three_prd_indicators(self):
        from support.models import SupportTicket

        SupportTicket.objects.create(user=self.passenger, subject="Didn't realize the bundle expired")
        SupportTicket.objects.create(user=self.passenger, subject="Rider was late")
        admin = User.objects.create_user(phone="+233200000099", role="admin")
        c = APIClient(); c.force_authenticate(admin)
        d = c.get("/api/admin/trust-indicators").data
        self.assertEqual(d["pressure_language_tickets"]["count"], 1)
        self.assertIn("rate", d["notification_opt_out"])
        self.assertIn("gini", d["driver_trip_distribution_7d"])


class PushTests(DispatchTestBase):
    def test_notifications_queue_push_only_for_registered_devices_and_never_raise(self):
        from core.models import notify

        c = APIClient(); c.force_authenticate(self.passenger)
        self.assertEqual(c.post("/api/devices", {"token": "nonsense"}, format="json").status_code, 400)
        c.post("/api/devices", {"token": "ExponentPushToken[abc]", "platform": "android", "app": "passenger"}, format="json")
        with mock.patch("core.tasks.send_push.delay", side_effect=RuntimeError("broker down")) as delay, \
             self.captureOnCommitCallbacks(execute=True):
            notify(self.passenger, "Rider assigned", category="trip")
        delay.assert_called_once()


class RatingTests(DispatchTestBase):
    def test_both_sides_rate_once_after_completion(self):
        trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(trip, self.driver_a)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        self.assertEqual(c.post(f"/api/trips/{trip.id}/rating", {"score": 5}, format="json").status_code, 409)
        services.start_trip(Trip.objects.get(id=trip.id))
        services.complete_trip(Trip.objects.get(id=trip.id))
        self.assertEqual(c.post(f"/api/trips/{trip.id}/rating", {"score": 4}, format="json").status_code, 201)
        self.assertEqual(c.post(f"/api/trips/{trip.id}/rating", {"score": 4}, format="json").status_code, 409)
        self.assertTrue(c.get(f"/api/trips/{trip.id}").data["rated_by_me"])
        c.force_authenticate(self.passenger)
        self.assertFalse(c.get(f"/api/trips/{trip.id}").data["rated_by_me"])
        self.assertEqual(c.post(f"/api/trips/{trip.id}/rating", {"score": 5}, format="json").status_code, 201)
