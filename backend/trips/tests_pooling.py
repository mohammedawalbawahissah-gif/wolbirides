"""WR-17 shared rides per the PRD: opt-in, pairs, base shared + own leg, never above solo."""
from decimal import Decimal

from rest_framework.test import APIClient

from accounts.models import User
from trips import services
from trips.models import PoolGroup, Trip
from trips.tests import DispatchTestBase

GATE = {"lat": Decimal("9.400000"), "lng": Decimal("-0.900000"), "label": "Main gate"}
NEAR_GATE = {"lat": Decimal("9.402000"), "lng": Decimal("-0.901000"), "label": "Library"}
HOSTEL = {"lat": Decimal("9.420000"), "lng": Decimal("-0.880000"), "label": "Hostel"}
NEAR_HOSTEL = {"lat": Decimal("9.421000"), "lng": Decimal("-0.881000"), "label": "Hostel annex"}
FAR = {"lat": Decimal("9.300000"), "lng": Decimal("-0.990000"), "label": "Town"}


class PoolingTests(DispatchTestBase):
    def setUp(self):
        super().setUp()
        self.passenger2 = User.objects.create_user(phone="+233200000002", name="Kojo Mensah", role="passenger")
        self.passenger3 = User.objects.create_user(phone="+233200000003", name="Efua", role="passenger")

    def _shareable(self, passenger, pickup, dest):
        trip = services.request_trip(passenger, self.zone, pickup, dest, options={"shareable": True})
        services.start_dispatch_cascade(trip)
        trip.refresh_from_db()
        return trip

    def _lead(self):
        """First shareable passenger, dispatched (offered to driver_a) but not yet accepted."""
        return self._request_trip_scored([(1.0, str(self.driver_a.user_id))], options={"shareable": True})

    def test_no_discount_unless_actually_shared(self):
        trip = services.request_trip(self.passenger, self.zone, GATE, HOSTEL, options={"shareable": True})
        solo = services.request_trip(self.passenger2, self.zone, GATE, HOSTEL)
        self.assertEqual(trip.fare_quote.total, solo.fare_quote.total)
        self.assertIsNone(trip.pool_seat_fare)

    def test_two_searching_passengers_pair_and_match_together(self):
        lead = self._lead()
        second = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        self.assertEqual(second.status, Trip.Status.MATCHING)
        self.assertEqual(second.pool_group_id, Trip.objects.get(id=lead.id).pool_group_id)
        self.assertFalse(second.events.filter(event_type="offered_to_driver").exists())
        services.accept_trip(lead, self.driver_a)
        second.refresh_from_db()
        self.assertEqual((second.status, second.driver_id), (Trip.Status.MATCHED, self.driver_a.id))

    def test_fare_split_base_shared_own_leg_never_above_solo(self):
        lead = self._lead()
        second = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        services.accept_trip(lead, self.driver_a)
        for t in (Trip.objects.get(id=lead.id), Trip.objects.get(id=second.id)):
            q = t.fare_quote
            self.assertEqual(t.pool_seat_fare, q.base_fare / 2 + q.per_km_charge)
            self.assertLess(t.pool_seat_fare, q.total)
        driver_total = sum(Trip.objects.get(id=i).pool_seat_fare for i in (lead.id, second.id))
        self.assertGreater(driver_total, max(lead.fare_quote.total, second.fare_quote.total))

    def test_passenger_left_alone_pays_solo_fare_again(self):
        lead = self._lead()
        second = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        services.accept_trip(lead, self.driver_a)
        services.cancel_trip(Trip.objects.get(id=second.id), "passenger")
        self.assertIsNone(Trip.objects.get(id=lead.id).pool_seat_fare)

    def test_waiting_passenger_dispatched_alone_if_partner_finds_no_driver(self):
        lead = self._lead()
        second = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        services.decline_or_timeout(lead, str(self.driver_a.user_id))  # nobody else online
        self.assertEqual(Trip.objects.get(id=lead.id).status, Trip.Status.NO_DRIVERS_FOUND)
        self.assertTrue(Trip.objects.get(id=second.id).events.filter(event_type="pool_partner_left").exists())

    def test_join_driver_already_heading_out(self):
        lead = self._lead()
        services.accept_trip(lead, self.driver_a)
        second = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        self.assertEqual((second.status, second.driver_id), (Trip.Status.MATCHED, self.driver_a.id))

    def test_cap_is_two_passengers(self):
        lead = self._lead()
        self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        third = self._shareable(self.passenger3, GATE, HOSTEL)
        self.assertNotEqual(third.pool_group_id, Trip.objects.get(id=lead.id).pool_group_id)

    def test_different_destination_or_private_ride_never_pools(self):
        self._lead()
        far = self._shareable(self.passenger2, NEAR_GATE, FAR)
        self.assertIsNone(far.pool_group_id)
        private = services.request_trip(self.passenger3, self.zone, NEAR_GATE, NEAR_HOSTEL)
        services.start_dispatch_cascade(private)
        self.assertIsNone(Trip.objects.get(id=private.id).pool_group_id)

    def test_group_closes_at_first_pickup(self):
        lead = self._lead()
        services.accept_trip(lead, self.driver_a)
        services.start_trip(Trip.objects.get(id=lead.id))
        late = self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        self.assertNotEqual(late.driver_id, self.driver_a.id)
        self.assertEqual(PoolGroup.objects.get(id=Trip.objects.get(id=lead.id).pool_group_id).status, "closed")

    def test_driver_gets_sequenced_stops_passengers_do_not(self):
        lead = self._lead()
        self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        services.accept_trip(lead, self.driver_a)
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        stops = c.get(f"/api/trips/{lead.id}").data["pool_info"]["stops"]
        self.assertEqual([s["type"] for s in stops], ["pickup", "pickup", "dropoff", "dropoff"])
        c.force_authenticate(self.passenger)
        info = c.get(f"/api/trips/{lead.id}").data["pool_info"]
        self.assertNotIn("stops", info)
        self.assertEqual(info["passenger_count"], 2)

    def test_offer_to_driver_includes_both_legs(self):
        lead = self._lead()
        self._shareable(self.passenger2, NEAR_GATE, NEAR_HOSTEL)
        from trips.pooling import offer_legs

        legs = offer_legs(Trip.objects.get(id=lead.id))
        self.assertEqual(len(legs), 4)


class BusyDriverTests(DispatchTestBase):
    def test_driver_on_a_trip_gets_no_new_offers(self):
        busy_trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(busy_trip, self.driver_a)
        next_trip = self._request_trip_scored([(0.2, str(self.driver_a.user_id)), (1.5, str(self.driver_b.user_id))])
        self.assertEqual(services.current_offered_driver_id(next_trip), str(self.driver_b.user_id))
