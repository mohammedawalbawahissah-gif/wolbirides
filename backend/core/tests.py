from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import Notification, notify


class NotificationPreferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+233200000001", role="passenger")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_defaults_to_enabled_and_only_lists_optional_categories(self):
        response = self.client.get("/api/notifications/preferences")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p["category"] for p in response.data], ["recurring_reminder"])
        self.assertTrue(response.data[0]["enabled"])

    def test_opt_out_is_honoured_but_functional_categories_are_not(self):
        response = self.client.patch(
            "/api/notifications/preferences",
            [{"category": "recurring_reminder", "enabled": False}, {"category": "trip", "enabled": False}],
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data[0]["enabled"])
        self.assertIsNone(notify(self.user, "Reminder", category=Notification.Category.RECURRING_REMINDER))
        self.assertIsNotNone(notify(self.user, "Rider assigned", category=Notification.Category.TRIP))
