"""Refresh-token rotation, history paging, admin location."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from trips.models import Trip
from trips.services import HISTORY_PAGE_SIZE
from zones.models import ServiceZone


class RotationTests(TestCase):
    def setUp(self):
        cache.clear()  # login throttling is keyed by email; start from a clean slate

    def test_refresh_returns_new_token_and_old_one_stops_working(self):
        User.objects.create_user_with_email(email="rotation@uds.edu.gh", password="Tamale-Rides-2026", name="Ama")
        c = APIClient()
        first = c.post("/api/auth/login", {"email": "rotation@uds.edu.gh", "password": "Tamale-Rides-2026"}, format="json").data["refresh"]
        r = c.post("/api/auth/token/refresh", {"refresh": first}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("refresh", r.data)
        self.assertNotEqual(r.data["refresh"], first)
        # A stolen copy of the old refresh token is now useless.
        self.assertEqual(c.post("/api/auth/token/refresh", {"refresh": first}, format="json").status_code, 401)
        # The new one keeps working.
        self.assertEqual(c.post("/api/auth/token/refresh", {"refresh": r.data["refresh"]}, format="json").status_code, 200)

    def test_flush_task_runs(self):
        from core.tasks import flush_expired_tokens

        flush_expired_tokens()


class HistoryPagingTests(TestCase):
    def test_older_trips_reachable_page_by_page(self):
        rider = User.objects.create_user(phone="+233200000001", role="passenger")
        zone = ServiceZone.objects.create(name="Z", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        now = timezone.now()
        trips = [Trip(passenger=rider, zone=zone, status="completed", pickup_lat=9.4, pickup_lng=-0.9,
                      destination_lat=9.42, destination_lng=-0.88) for _ in range(120)]
        Trip.objects.bulk_create(trips)
        for i, t in enumerate(Trip.objects.all()):
            Trip.objects.filter(id=t.id).update(requested_at=now - timedelta(minutes=i))
        c = APIClient(); c.force_authenticate(rider)
        seen, before = [], None
        while True:
            page = c.get("/api/passengers/me/rides" + (f"?before={before}" if before else "")).data
            seen += [t["id"] for t in page]
            if len(page) < HISTORY_PAGE_SIZE:
                break
            before = page[-1]["requested_at"]
        self.assertEqual(len(seen), 120)          # previously capped at 100
        self.assertEqual(len(set(seen)), 120)     # no duplicates across pages


class AdminLocationTests(TestCase):
    def test_admin_served_from_configured_path(self):
        from django.conf import settings

        r = APIClient().get(f"/{settings.ADMIN_PATH}")
        self.assertIn(r.status_code, (200, 302))
