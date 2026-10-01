from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import EmailOTPRequest, User
from accounts.services import request_email_otp, request_password_reset


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PasswordResetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user_with_email(email="ama@uds.edu.gh", password="Tamale-Rides-2026", name="Ama")
        self.c = APIClient()

    def _code(self):
        """Pull the code out of the email that was actually sent."""
        import re

        return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

    def test_full_reset_signs_in_and_old_password_stops_working(self):
        r = self.c.post("/api/auth/password/reset/request", {"email": "AMA@uds.edu.gh"}, format="json")
        self.assertEqual(r.status_code, 200)
        r = self.c.post("/api/auth/password/reset/confirm",
                        {"email": "ama@uds.edu.gh", "code": self._code(), "new_password": "New-Yellow-Ride-9"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertEqual(self.c.post("/api/auth/login", {"email": "ama@uds.edu.gh", "password": "Tamale-Rides-2026"},
                                     format="json").status_code, 400)
        self.assertEqual(self.c.post("/api/auth/login", {"email": "ama@uds.edu.gh", "password": "New-Yellow-Ride-9"},
                                     format="json").status_code, 200)
        self.assertIn("password was changed", mail.outbox[-1].subject)

    def test_unknown_email_gets_same_answer_and_no_email(self):
        r = self.c.post("/api/auth/password/reset/request", {"email": "nobody@uds.edu.gh"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_signup_code_cannot_reset_a_password(self):
        request_email_otp("ama@uds.edu.gh")  # a sign-up code for the same address
        code = self._code()
        r = self.c.post("/api/auth/password/reset/confirm",
                        {"email": "ama@uds.edu.gh", "code": code, "new_password": "New-Yellow-Ride-9"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_weak_password_rejected_and_code_still_usable(self):
        request_password_reset("ama@uds.edu.gh")
        code = self._code()
        r = self.c.post("/api/auth/password/reset/confirm",
                        {"email": "ama@uds.edu.gh", "code": code, "new_password": "password123"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/auth/password/reset/confirm",
                        {"email": "ama@uds.edu.gh", "code": code, "new_password": "New-Yellow-Ride-9"}, format="json")
        self.assertEqual(r.status_code, 200)

    def test_code_is_single_use(self):
        request_password_reset("ama@uds.edu.gh")
        code = self._code()
        body = {"email": "ama@uds.edu.gh", "code": code, "new_password": "New-Yellow-Ride-9"}
        self.assertEqual(self.c.post("/api/auth/password/reset/confirm", body, format="json").status_code, 200)
        body["new_password"] = "Another-Ride-77"
        self.assertEqual(self.c.post("/api/auth/password/reset/confirm", body, format="json").status_code, 400)

    def test_reset_signs_out_other_devices(self):
        other_device = self.c.post("/api/auth/login", {"email": "ama@uds.edu.gh", "password": "Tamale-Rides-2026"},
                                   format="json").data["refresh"]
        request_password_reset("ama@uds.edu.gh")
        self.c.post("/api/auth/password/reset/confirm",
                    {"email": "ama@uds.edu.gh", "code": self._code(), "new_password": "New-Yellow-Ride-9"}, format="json")
        r = self.c.post("/api/auth/token/refresh", {"refresh": other_device}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_codes_use_secure_randomness(self):
        with mock.patch("accounts.services.secrets.randbelow", return_value=42) as rb:
            request_password_reset("ama@uds.edu.gh")
        rb.assert_called_once()
        self.assertIn("000042", mail.outbox[-1].body)
        self.assertEqual(EmailOTPRequest.objects.get().purpose, "password_reset")

    def test_signup_uses_the_same_password_rules(self):
        request_email_otp("kofi@uds.edu.gh")
        r = self.c.post("/api/auth/signup", {"email": "kofi@uds.edu.gh", "code": self._code(), "password": "password123",
                                             "name": "Kofi"}, format="json")
        self.assertEqual(r.status_code, 400)


class ListShapeTests(TestCase):
    """Every passenger app reads these as plain arrays (a paginated object blanked the web home page)."""

    def test_personal_lists_are_plain_arrays_and_not_truncated(self):
        from accounts.models import SavedAddress

        user = User.objects.create_user(phone="+233200000001", role="passenger")
        for i in range(25):
            SavedAddress.objects.create(user=user, label=f"Place {i}", lat="9.4", lng="-0.9")
        c = APIClient(); c.force_authenticate(user)
        addresses = c.get("/api/passengers/me/addresses").data
        self.assertIsInstance(addresses, list)
        self.assertEqual(len(addresses), 25)
        self.assertIsInstance(c.get("/api/passengers/me/recurring-rides").data, list)
