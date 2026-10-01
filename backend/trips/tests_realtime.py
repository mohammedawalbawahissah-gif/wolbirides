"""
Live channels (H1/H2 from the audit) exercised through the real ASGI stack:
JWT query-string auth -> URL router -> consumer, exactly as the apps connect.
"""
from decimal import Decimal
from unittest import mock

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase, override_settings
from rest_framework_simplejwt.tokens import AccessToken

from accounts.models import User
from drivers.models import Driver
from trips import services
from trips.models import Trip
from trips.tests import _make_driver
from wolbirides.asgi import application
from zones.models import ServiceZone

LAYER = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def token(user):
    return str(AccessToken.for_user(user))


async def next_non_tracking(comm, timeout=2):
    """Next message that isn't a tracking_mode hint, or None if nothing else arrives."""
    while True:
        if await comm.receive_nothing(timeout=0.3):
            return None
        msg = await comm.receive_json_from(timeout=timeout)
        if msg.get("type") != "tracking_mode":
            return msg


@override_settings(CHANNEL_LAYERS=LAYER, FAIR_QUEUE_SHARE=0.0)
class RealtimeTests(TransactionTestCase):
    def setUp(self):
        for target in ("trips.tasks.check_dispatch_offer_timeout.apply_async", "trips.matching.remove_driver_location_sync"):
            p = mock.patch(target); p.start(); self.addCleanup(p.stop)
        self.writes = mock.patch("trips.consumers.write_driver_location", new=mock.AsyncMock())
        self.write_mock = self.writes.start(); self.addCleanup(self.writes.stop)
        p = mock.patch("trips.consumers.remove_driver_location", new=mock.AsyncMock()); p.start(); self.addCleanup(p.stop)
        self.zone = ServiceZone.objects.create(name="Z", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        self.passenger = User.objects.create_user(phone="+233200000001", role="passenger")
        self.other = User.objects.create_user(phone="+233200000002", role="passenger")
        self.driver = _make_driver("+233200000011")
        self.trip = Trip.objects.create(passenger=self.passenger, driver=self.driver, zone=self.zone, status="matched",
                                        pickup_lat=9.4, pickup_lng=-0.9, destination_lat=9.42, destination_lng=-0.88)

    def _connect(self, path, user=None):
        async def go():
            url = f"/{path}" + (f"?token={token(user)}" if user else "")
            comm = WebsocketCommunicator(application, url)
            ok, code = await comm.connect()
            await comm.disconnect()
            return ok
        return async_to_sync(go)()

    # --- H2: trip channel authorization ---
    def test_trip_channel_only_for_people_on_the_trip(self):
        path = f"ws/trip/{self.trip.id}/"
        self.assertTrue(self._connect(path, self.passenger))
        self.assertTrue(self._connect(path, self.driver.user))
        self.assertFalse(self._connect(path, self.other))
        other_driver = _make_driver("+233200000012")
        self.assertFalse(self._connect(path, other_driver.user))  # e.g. a driver who declined the offer
        self.assertFalse(self._connect(path))  # anonymous
        self.assertFalse(self._connect("ws/trip/00000000-0000-0000-0000-000000000000/", self.passenger))

    # --- H1: driver channel eligibility ---
    def test_unverified_driver_cannot_connect(self):
        pending = _make_driver("+233200000013", status=Driver.VerificationStatus.PENDING)
        self.assertFalse(self._connect("ws/driver/location/", pending.user))
        self.assertTrue(self._connect("ws/driver/location/", self.driver.user))

    def _ping_session(self, user, before_ping=None):
        async def go():
            comm = WebsocketCommunicator(application, f"/ws/driver/location/?token={token(user)}")
            ok, _ = await comm.connect()
            assert ok
            if before_ping:
                await before_ping()
            await comm.send_json_to({"type": "location.ping", "lat": 9.4, "lng": -0.9, "zone_id": str(self.zone.id)})
            reply = await next_non_tracking(comm)
            await comm.disconnect()
            return reply
        return async_to_sync(go)()

    def test_online_driver_pings_are_recorded(self):
        self.assertIsNone(self._ping_session(self.driver.user))
        self.write_mock.assert_awaited()

    def test_offline_driver_pings_are_refused(self):
        Driver.objects.filter(id=self.driver.id).update(is_online=False)
        reply = self._ping_session(self.driver.user)
        self.assertEqual(reply["type"], "force_offline")
        self.write_mock.assert_not_awaited()

    def test_suspension_pushes_force_offline_to_a_connected_driver(self):
        async def suspend_mid_session():
            from asgiref.sync import sync_to_async
            from incidents.models import Incident
            from incidents.services import create_incident

            await sync_to_async(create_incident)(self.passenger, Incident.Severity.P0_CRITICAL, "SOS", trip=self.trip)

        async def go():
            comm = WebsocketCommunicator(application, f"/ws/driver/location/?token={token(self.driver.user)}")
            ok, _ = await comm.connect(); assert ok
            await suspend_mid_session()
            pushed = await next_non_tracking(comm)
            await comm.send_json_to({"type": "location.ping", "lat": 9.4, "lng": -0.9, "zone_id": str(self.zone.id)})
            after = await next_non_tracking(comm)
            await comm.disconnect()
            return pushed, after
        pushed, after = async_to_sync(go)()
        self.assertEqual(pushed, {"type": "force_offline", "reason": "suspended"})
        self.assertEqual(after["type"], "force_offline")
        self.write_mock.assert_not_awaited()
        self.driver.refresh_from_db()
        self.assertEqual((self.driver.verification_status, self.driver.is_online), ("suspended", False))



    def test_passenger_sees_matched_then_arriving_then_started_live(self):
        """The passenger's own /ws/trip/<id>/ socket, not just the driver's, must update at each stage —
        this is what the trip-status screen re-fetches on to show the driver as soon as they're assigned."""
        # setUp's own fixture trip has this driver "matched" already — free them, or dispatch correctly
        # treats them as busy and this test's booking finds nobody.
        Trip.objects.filter(id=self.trip.id).update(status="cancelled")

        async def scored(*a, **k):
            return [(0.5, str(self.driver.user_id))]

        async def go():
            from asgiref.sync import sync_to_async

            def book():
                with mock.patch("trips.services.scored_candidate_drivers", side_effect=scored):
                    trip = services.request_trip(self.passenger, self.zone, {"lat": Decimal("9.4"), "lng": Decimal("-0.9")},
                                                 {"lat": Decimal("9.42"), "lng": Decimal("-0.88")})
                    services.start_dispatch_cascade(trip)
                return trip.id

            def do_accept(trip_id):
                services.accept_trip(Trip.objects.get(id=trip_id), self.driver)

            def do_arrive(trip_id):
                services.mark_driver_arriving(Trip.objects.get(id=trip_id))

            def do_start(trip_id):
                services.start_trip(Trip.objects.get(id=trip_id))

            trip_id = await sync_to_async(book, thread_sensitive=False)()
            comm = WebsocketCommunicator(application, f"/ws/trip/{trip_id}/?token={token(self.passenger)}")
            ok, _ = await comm.connect(); assert ok

            await sync_to_async(do_accept, thread_sensitive=False)(trip_id)
            matched = await comm.receive_json_from(timeout=2)

            await sync_to_async(do_arrive, thread_sensitive=False)(trip_id)
            arriving = await comm.receive_json_from(timeout=2)

            await sync_to_async(do_start, thread_sensitive=False)(trip_id)
            started = await comm.receive_json_from(timeout=2)
            await comm.disconnect()
            return matched, arriving, started

        matched, arriving, started = async_to_sync(go)()
        self.assertEqual(matched["status"], "matched")
        self.assertEqual(matched["driver_id"], str(self.driver.id))
        self.assertEqual(arriving["status"], "driver_arriving")
        self.assertEqual(started["status"], "in_progress")


class DispatchEligibilityTests(TransactionTestCase):
    """H1 at the dispatch step itself: presence in Redis is not enough."""

    def setUp(self):
        for target in ("trips.tasks.check_dispatch_offer_timeout.apply_async", "trips.matching.remove_driver_location_sync"):
            p = mock.patch(target); p.start(); self.addCleanup(p.stop)
        self.zone = ServiceZone.objects.create(name="Z", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        self.passenger = User.objects.create_user(phone="+233200000001", role="passenger")

    @override_settings(CHANNEL_LAYERS=LAYER, FAIR_QUEUE_SHARE=0.0)
    def test_suspended_or_offline_drivers_are_skipped(self):
        near_suspended = _make_driver("+233200000021", status=Driver.VerificationStatus.SUSPENDED)
        near_offline = _make_driver("+233200000022", online=False)
        eligible = _make_driver("+233200000023")

        async def scored(*a, **k):
            return [(0.1, str(near_suspended.user_id)), (0.2, str(near_offline.user_id)), (0.9, str(eligible.user_id))]

        with mock.patch("trips.services.scored_candidate_drivers", side_effect=scored):
            trip = services.request_trip(self.passenger, self.zone, {"lat": Decimal("9.4"), "lng": Decimal("-0.9")},
                                         {"lat": Decimal("9.42"), "lng": Decimal("-0.88")})
            services.start_dispatch_cascade(trip)
        self.assertEqual(services.current_offered_driver_id(trip), str(eligible.user_id))


@override_settings(CHANNEL_LAYERS=LAYER, FAIR_QUEUE_SHARE=0.0)
class TrackingModeTests(TransactionTestCase):
    def setUp(self):
        for target in ("trips.tasks.check_dispatch_offer_timeout.apply_async", "trips.matching.remove_driver_location_sync"):
            p = mock.patch(target); p.start(); self.addCleanup(p.stop)
        for target in ("trips.consumers.write_driver_location", "trips.consumers.remove_driver_location"):
            p = mock.patch(target, new=mock.AsyncMock()); p.start(); self.addCleanup(p.stop)
        self.zone = ServiceZone.objects.create(name="Z", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        self.passenger = User.objects.create_user(phone="+233200000001", role="passenger")
        self.driver = _make_driver("+233200000011")

    def test_idle_on_connect_and_active_once_a_trip_is_accepted(self):
        async def scored(*a, **k):
            return [(0.5, str(self.driver.user_id))]

        async def go():
            from asgiref.sync import sync_to_async

            comm = WebsocketCommunicator(application, f"/ws/driver/location/?token={token(self.driver.user)}")
            ok, _ = await comm.connect(); assert ok
            first = await comm.receive_json_from(timeout=2)

            def book_and_accept():
                with mock.patch("trips.services.scored_candidate_drivers", side_effect=scored):
                    trip = services.request_trip(self.passenger, self.zone, {"lat": Decimal("9.4"), "lng": Decimal("-0.9")},
                                                 {"lat": Decimal("9.42"), "lng": Decimal("-0.88")})
                    services.start_dispatch_cascade(trip)
                    services.accept_trip(Trip.objects.get(id=trip.id), self.driver)

            await sync_to_async(book_and_accept)()
            msgs = []
            while not await comm.receive_nothing(timeout=0.3):
                msgs.append(await comm.receive_json_from())
            await comm.disconnect()
            return first, msgs
        first, msgs = async_to_sync(go)()
        self.assertEqual(first, {"type": "tracking_mode", "mode": "idle"})
        self.assertIn({"type": "tracking_mode", "mode": "active"}, msgs)
