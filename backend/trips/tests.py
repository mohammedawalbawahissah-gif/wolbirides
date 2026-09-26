"""
Trip state-machine, dispatch-offer and SOS tests.

Redis, Celery and the channel layer are replaced with in-process stand-ins so
these run anywhere with `python manage.py test` — no broker or Redis needed.
"""
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from drivers.models import Driver
from incidents.models import Incident
from trips import services
from trips.models import Trip
from zones.models import ServiceZone

IN_MEMORY_LAYER = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def _make_driver(phone, status=Driver.VerificationStatus.VERIFIED, online=True):
    """A driver as dispatch sees them: verified and switched online (the apps call drivers/me/status)."""
    user = User.objects.create_user(phone=phone, name=f"Driver {phone[-2:]}", role="driver")
    return Driver.objects.create(user=user, licence_number=f"L-{phone[-4:]}", verification_status=status,
                                 is_online=online and status == Driver.VerificationStatus.VERIFIED)


# The WR-20 fairness floor is random by design; off by default so tests are deterministic.
@override_settings(CHANNEL_LAYERS=IN_MEMORY_LAYER, FAIR_QUEUE_SHARE=0.0)
class DispatchTestBase(TestCase):
    def setUp(self):
        self.timeout_patch = mock.patch("trips.tasks.check_dispatch_offer_timeout.apply_async")
        self.timeout_patch.start()
        self.addCleanup(self.timeout_patch.stop)
        redis_patch = mock.patch("trips.matching.remove_driver_location_sync")
        redis_patch.start()
        self.addCleanup(redis_patch.stop)

        self.zone = ServiceZone.objects.create(
            name="UDS Nyankpala",
            boundary={"min_lat": 9.3, "max_lat": 9.5, "min_lng": -1.0, "max_lng": -0.8},
            base_fare=Decimal("5.00"),
            per_km_rate=Decimal("2.50"),
        )
        self.passenger = User.objects.create_user(phone="+233200000001", name="Ama", role="passenger")
        self.driver_a = _make_driver("+233200000011")
        self.driver_b = _make_driver("+233200000012")

    def _request_trip_offered_to(self, *drivers):
        """Create a trip and dispatch it; ranking returns drivers in the given order."""
        order = [str(d.user_id) for d in drivers]

        return self._request_trip_scored([(1.0 + 0.1 * i, d) for i, d in enumerate(order)])

    def _request_trip_scored(self, scored, **request_kwargs):
        """Dispatch a trip where the matching engine sees these (distance_km, driver_user_id) pairs."""

        async def fake_scored(zone_id, lat, lng, exclude_driver_ids=None):
            exclude = exclude_driver_ids or set()
            return [(dist, d) for dist, d in scored if d not in exclude]

        patcher = mock.patch("trips.services.scored_candidate_drivers", side_effect=fake_scored)
        patcher.start()
        self.addCleanup(patcher.stop)

        trip = services.request_trip(
            self.passenger, self.zone,
            {"lat": Decimal("9.400000"), "lng": Decimal("-0.900000"), "label": "Main gate"},
            {"lat": Decimal("9.420000"), "lng": Decimal("-0.880000"), "label": "Hostel"},
            **request_kwargs,
        )
        services.start_dispatch_cascade(trip)
        trip.refresh_from_db()
        return trip


class AcceptDeclineTests(DispatchTestBase):
    def test_offered_driver_can_accept(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        services.accept_trip(trip, self.driver_a)
        trip.refresh_from_db()
        self.assertEqual(trip.status, Trip.Status.MATCHED)
        self.assertEqual(trip.driver_id, self.driver_a.id)

    def test_driver_not_offered_cannot_accept(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        with self.assertRaises(services.OfferNotValid):
            services.accept_trip(trip, self.driver_b)
        trip.refresh_from_db()
        self.assertEqual(trip.status, Trip.Status.MATCHING)
        self.assertIsNone(trip.driver_id)

    def test_second_accept_is_rejected(self):
        trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(trip, self.driver_a)
        with self.assertRaises(services.OfferNotValid):
            services.accept_trip(trip, self.driver_a)

    def test_unverified_driver_cannot_accept_even_if_offered(self):
        trip = self._request_trip_offered_to(self.driver_a)
        self.driver_a.verification_status = Driver.VerificationStatus.SUSPENDED
        self.driver_a.save()
        with self.assertRaises(services.OfferNotValid):
            services.accept_trip(trip, self.driver_a)

    def test_decline_cascades_to_next_driver(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        services.decline_or_timeout(trip, str(self.driver_a.user_id))
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))
        services.accept_trip(trip, self.driver_b)
        trip.refresh_from_db()
        self.assertEqual(trip.driver_id, self.driver_b.id)

    def test_stale_timeout_does_not_steal_current_offer(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        services.decline_or_timeout(trip, str(self.driver_a.user_id))  # A declines -> B offered
        # A's original 18s timeout fires late; B must keep the offer.
        self.assertIsNone(services.decline_or_timeout(trip, str(self.driver_a.user_id)))
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_b.user_id))

    def test_other_driver_cannot_decline_on_someones_behalf(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        self.assertIsNone(services.decline_or_timeout(trip, str(self.driver_b.user_id)))
        self.assertEqual(services.current_offered_driver_id(trip), str(self.driver_a.user_id))

    def test_last_decline_marks_no_drivers_found(self):
        trip = self._request_trip_offered_to(self.driver_a)
        services.decline_or_timeout(trip, str(self.driver_a.user_id))
        trip.refresh_from_db()
        self.assertEqual(trip.status, Trip.Status.NO_DRIVERS_FOUND)

    def test_accept_endpoint_returns_409_for_wrong_driver(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        client = APIClient()
        client.force_authenticate(self.driver_b.user)
        response = client.post(f"/api/trips/{trip.id}/accept")
        self.assertEqual(response.status_code, 409)

    def test_decline_endpoint_returns_409_for_wrong_driver(self):
        trip = self._request_trip_offered_to(self.driver_a, self.driver_b)
        client = APIClient()
        client.force_authenticate(self.driver_b.user)
        response = client.post(f"/api/trips/{trip.id}/decline")
        self.assertEqual(response.status_code, 409)


class FareTests(DispatchTestBase):
    def test_fare_uses_server_distance_not_client_claim(self):
        trip = services.request_trip(
            self.passenger, self.zone,
            {"lat": Decimal("9.400000"), "lng": Decimal("-0.900000")},
            {"lat": Decimal("9.445000"), "lng": Decimal("-0.900000")},
            client_reported_distance_km=0.01,
        )
        self.assertGreater(trip.fare_quote.distance_km, Decimal("4.9"))
        self.assertTrue(trip.events.filter(event_type="distance_mismatch").exists())


class SOSTests(DispatchTestBase):
    def setUp(self):
        super().setUp()
        self.trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(self.trip, self.driver_a)
        self.admin = User.objects.create_user(phone="+233200000099", name="Ops", role="admin")
        self.client = APIClient()

    def _sos(self, user, **body):
        self.client.force_authenticate(user)
        return self.client.post(f"/api/trips/{self.trip.id}/sos", body, format="json")

    @mock.patch("accounts.services._send_sms")
    def test_passenger_sos_creates_p0_suspends_driver_and_alerts(self, send_sms):
        self.passenger.emergency_contact_phone = "+233240000000"
        self.passenger.save()
        response = self._sos(self.passenger, lat="9.401000", lng="-0.899000")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["emergency_number"], "112")
        self.assertTrue(response.data["contact_notified"])

        incident = Incident.objects.get(id=response.data["incident_id"])
        self.assertEqual(incident.trigger_source, "sos_button")
        self.assertEqual(incident.severity, Incident.Severity.P0_CRITICAL)
        self.driver_a.refresh_from_db()
        self.assertEqual(self.driver_a.verification_status, Driver.VerificationStatus.SUSPENDED)
        self.assertTrue(self.admin.notifications.filter(category="incident").exists())
        send_sms.assert_called_once()
        self.assertTrue(self.trip.events.filter(event_type="sos_raised").exists())

    def test_driver_sos_does_not_suspend_the_driver(self):
        response = self._sos(self.driver_a.user)
        self.assertEqual(response.status_code, 201)
        self.driver_a.refresh_from_db()
        self.assertEqual(self.driver_a.verification_status, Driver.VerificationStatus.VERIFIED)

    def test_outsider_cannot_raise_sos(self):
        stranger = User.objects.create_user(phone="+233200000050", role="passenger")
        self.assertEqual(self._sos(stranger).status_code, 403)

    @mock.patch("accounts.services._send_sms", side_effect=RuntimeError("SMS down"))
    def test_sms_failure_does_not_block_alert(self, _):
        self.passenger.emergency_contact_phone = "+233240000000"
        self.passenger.save()
        response = self._sos(self.passenger)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Incident.objects.filter(trigger_source="sos_button").exists())
