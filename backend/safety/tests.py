from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import SavedAddress, User
from incidents.models import Incident
from safety.models import SafetyCheckIn
from safety.services import run_safety_checks
from trips import services
from trips.models import Trip
from trips.tests import DispatchTestBase


class _ActiveTripBase(DispatchTestBase):
    def setUp(self):
        super().setUp()
        self.trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(self.trip, self.driver_a)
        services.start_trip(Trip.objects.get(id=self.trip.id))
        self.trip.refresh_from_db()
        self.client = APIClient()
        self.client.force_authenticate(self.passenger)


class ShareTests(_ActiveTripBase):
    def test_passenger_can_share_and_anyone_can_follow(self):
        r = self.client.post(f"/api/trips/{self.trip.id}/share", {}, format="json")
        self.assertEqual(r.status_code, 201)
        public = APIClient().get(f"/api/share/{r.data['token']}")
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data["status"], "in_progress")
        self.assertNotIn("phone", str(public.data))  # no contact details leak
        self.assertEqual(public.data["passenger_first_name"], "Ama")

    def test_driver_cannot_share(self):
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        self.assertEqual(c.post(f"/api/trips/{self.trip.id}/share").status_code, 403)

    def test_revoked_link_stops_working(self):
        token = self.client.post(f"/api/trips/{self.trip.id}/share").data["token"]
        self.client.delete(f"/api/trips/{self.trip.id}/share")
        self.assertEqual(APIClient().get(f"/api/share/{token}").status_code, 404)

    def test_link_expires_30_min_after_trip_ends(self):
        token = self.client.post(f"/api/trips/{self.trip.id}/share").data["token"]
        Trip.objects.filter(id=self.trip.id).update(status="completed", completed_at=timezone.now() - timedelta(minutes=31))
        self.assertEqual(APIClient().get(f"/api/share/{token}").status_code, 404)

    @mock.patch("accounts.services._send_sms")
    def test_send_to_contact_texts_the_link(self, send_sms):
        self.passenger.emergency_contact_phone = "+233240000000"
        self.passenger.save()
        r = self.client.post(f"/api/trips/{self.trip.id}/share", {"send_to_contact": True}, format="json")
        self.assertTrue(r.data["sent_to_contact"])
        self.assertIn(r.data["token"], send_sms.call_args[0][1])


@override_settings(SAFETY_EXPECTED_SPEED_KMH=15, SAFETY_OVERDUE_FACTOR=2, SAFETY_OVERDUE_GRACE_MINUTES=10,
                   SAFETY_CHECKIN_RESPONSE_MINUTES=3)
class CheckInTests(_ActiveTripBase):
    def _age_trip(self, minutes):
        Trip.objects.filter(id=self.trip.id).update(started_at=timezone.now() - timedelta(minutes=minutes))

    def test_on_time_trip_gets_no_prompt(self):
        self._age_trip(5)
        self.assertEqual(run_safety_checks(), (0, 0))

    def test_overdue_trip_prompts_once(self):
        self._age_trip(120)
        self.assertEqual(run_safety_checks()[0], 1)
        self.assertEqual(run_safety_checks()[0], 0)
        r = self.client.get(f"/api/trips/{self.trip.id}/safety-check")
        self.assertIsNotNone(r.data)

    def test_answering_ok_closes_prompt_without_incident(self):
        self._age_trip(120); run_safety_checks()
        r = self.client.post(f"/api/trips/{self.trip.id}/safety-check", {"response": "ok"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(self.client.get(f"/api/trips/{self.trip.id}/safety-check").data)
        self.assertFalse(Incident.objects.exists())

    def test_answering_help_raises_sos(self):
        self._age_trip(120); run_safety_checks()
        self.client.post(f"/api/trips/{self.trip.id}/safety-check", {"response": "help"}, format="json")
        self.assertTrue(Incident.objects.filter(trigger_source="sos_button", severity="p0").exists())

    @mock.patch("accounts.services._send_sms")
    def test_unanswered_prompt_escalates_without_suspending(self, send_sms):
        self.passenger.emergency_contact_phone = "+233240000000"
        self.passenger.save()
        self._age_trip(120); run_safety_checks()
        SafetyCheckIn.objects.update(created_at=timezone.now() - timedelta(minutes=4))
        self.assertEqual(run_safety_checks()[1], 1)
        self.assertTrue(Incident.objects.filter(severity="p1").exists())
        self.driver_a.refresh_from_db()
        self.assertEqual(self.driver_a.verification_status, "verified")
        send_sms.assert_called_once()


class MergeUsersTests(DispatchTestBase):
    def test_merge_moves_rows_and_deactivates_duplicate(self):
        dup = User.objects.create_user(phone="0200000001", name="", role="passenger")
        SavedAddress.objects.create(user=dup, label="Hostel", lat="9.4", lng="-0.9")
        out = StringIO()
        call_command("merge_users", keep=self.passenger.phone, merge=dup.phone, stdout=out)
        self.assertIn("Dry run", out.getvalue())
        self.assertEqual(SavedAddress.objects.filter(user=dup).count(), 1)

        call_command("merge_users", keep=self.passenger.phone, merge="0200000001", apply=True, stdout=StringIO())
        dup.refresh_from_db()
        self.assertFalse(dup.is_active)
        self.assertEqual(SavedAddress.objects.filter(user=self.passenger).count(), 1)
