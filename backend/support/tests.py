from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from trips.models import Trip
from zones.models import ServiceZone


class SupportTicketTests(TestCase):
    def setUp(self):
        self.rider = User.objects.create_user(phone="+233200000001", role="passenger")
        self.other = User.objects.create_user(phone="+233200000002", role="passenger")
        zone = ServiceZone.objects.create(name="UDS", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        self.trip = Trip.objects.create(passenger=self.rider, zone=zone, pickup_lat=9.4, pickup_lng=-0.9,
                                        destination_lat=9.42, destination_lng=-0.88)
        self.c = APIClient()

    def test_create_with_own_trip_and_list_mine(self):
        self.c.force_authenticate(self.rider)
        r = self.c.post("/api/support/tickets", {"category": "trip_issue", "subject": "Charged twice",
                                                 "trip": str(self.trip.id)}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(self.c.get("/api/support/tickets").data), 1)
        self.c.force_authenticate(self.other)
        self.assertEqual(self.c.get("/api/support/tickets").data, [])

    def test_cannot_attach_someone_elses_trip(self):
        self.c.force_authenticate(self.other)
        r = self.c.post("/api/support/tickets", {"subject": "x", "trip": str(self.trip.id)}, format="json")
        self.assertEqual(r.status_code, 400)


class StaffAccessTests(TestCase):
    """Support staff handle incidents and tickets; money and configuration stay admin-only."""

    def setUp(self):
        self.support = User.objects.create_user(phone="+233200000077", role="support")
        self.rider = User.objects.create_user(phone="+233200000001", role="passenger")
        self.c = APIClient(); self.c.force_authenticate(self.support)

    def test_support_can_do_operations_but_not_money_or_config(self):
        for url in ("/api/admin/incidents", "/api/admin/support/tickets", "/api/admin/trips",
                    "/api/admin/dashboard/summary", "/api/admin/dashboard/trends"):
            self.assertEqual(self.c.get(url).status_code, 200, url)
        for url in ("/api/admin/payouts/batches", "/api/admin/organizations", "/api/admin/zones",
                    "/api/admin/drivers", "/api/admin/placements", "/api/admin/dispatch/fairness"):
            self.assertEqual(self.c.get(url).status_code, 403, url)

    def test_riders_get_nothing(self):
        self.c.force_authenticate(self.rider)
        self.assertEqual(self.c.get("/api/admin/incidents").status_code, 403)

    def test_ticket_lifecycle_notifies_the_owner(self):
        from support.models import SupportTicket

        t = SupportTicket.objects.create(user=self.rider, subject="Charged twice")
        r = self.c.patch(f"/api/admin/support/tickets/{t.id}", {"status": "in_progress"}, format="json")
        self.assertEqual(r.data["status"], "in_progress")
        r = self.c.patch(f"/api/admin/support/tickets/{t.id}", {"status": "resolved"}, format="json")
        t.refresh_from_db()
        self.assertEqual(t.status, "resolved")
        self.assertIsNotNone(t.resolved_at)
        self.assertEqual(t.assigned_to, self.support)
        self.assertEqual(self.rider.notifications.filter(title__icontains="support request").count(), 2)
        self.assertEqual(self.c.patch(f"/api/admin/support/tickets/{t.id}", {"status": "bogus"}, format="json").status_code, 400)
        self.c.force_authenticate(self.rider)
        self.assertEqual(self.c.patch(f"/api/admin/support/tickets/{t.id}", {"status": "open"}, format="json").status_code, 403)
