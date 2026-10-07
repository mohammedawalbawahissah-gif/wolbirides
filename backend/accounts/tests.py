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


class PortalLoginGatingTests(TestCase):
    """
    SECURITY: /api/auth/login (passenger apps) and /api/drivers/auth/login (rider apps) must
    each refuse an account of the wrong role, the same way /api/admin/auth/login already refused
    anyone but admin/support. Before this, both passenger and rider apps shared one ungated
    endpoint, so either account type could sign in to either portal.
    """

    def setUp(self):
        from django.core.cache import cache

        cache.clear()  # login throttling is keyed by email; start from a clean slate
        self.passenger = User.objects.create_user_with_email(
            email="ama@uds.edu.gh", password="Tamale-Rides-2026", name="Ama", role="passenger")
        self.driver = User.objects.create_user_with_email(
            email="kofi@uds.edu.gh", password="Tamale-Rides-2026", name="Kofi", role="driver")
        self.admin = User.objects.create_user_with_email(
            email="ops@wolbirides.com", password="Tamale-Rides-2026", name="Ops", role="admin")
        self.c = APIClient()

    def test_a_passenger_account_can_sign_in_to_the_passenger_app(self):
        r = self.c.post("/api/auth/login", {"email": "ama@uds.edu.gh", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)

    def test_a_driver_account_is_turned_away_from_the_passenger_app(self):
        r = self.c.post("/api/auth/login", {"email": "kofi@uds.edu.gh", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["detail"], "This account is not authorized for the passenger app")
        self.assertNotIn("access", r.data)

    def test_an_admin_account_is_turned_away_from_the_passenger_app(self):
        r = self.c.post("/api/auth/login", {"email": "ops@wolbirides.com", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_a_driver_account_can_sign_in_to_the_rider_app(self):
        r = self.c.post("/api/drivers/auth/login", {"email": "kofi@uds.edu.gh", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)

    def test_a_passenger_account_is_turned_away_from_the_rider_app(self):
        r = self.c.post("/api/drivers/auth/login", {"email": "ama@uds.edu.gh", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["detail"], "This account is not authorized for the rider app")
        self.assertNotIn("access", r.data)

    def test_an_admin_account_is_turned_away_from_the_rider_app(self):
        r = self.c.post("/api/drivers/auth/login", {"email": "ops@wolbirides.com", "password": "Tamale-Rides-2026"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_a_passenger_and_driver_are_both_still_turned_away_from_the_admin_dashboard(self):
        for email in ("ama@uds.edu.gh", "kofi@uds.edu.gh"):
            r = self.c.post("/api/admin/auth/login", {"email": email, "password": "Tamale-Rides-2026"}, format="json")
            self.assertEqual(r.status_code, 403)

    def test_a_wrong_password_never_reveals_the_accounts_role_on_either_portal(self):
        """A bad password must look identical whether the account exists, and whichever role it
        is — the generic message, never the role-specific one, and never a 403."""
        for url, email in (
            ("/api/auth/login", "kofi@uds.edu.gh"),       # driver, wrong portal AND wrong password
            ("/api/drivers/auth/login", "ama@uds.edu.gh"),  # passenger, wrong portal AND wrong password
            ("/api/auth/login", "ama@uds.edu.gh"),          # passenger, right portal, wrong password
        ):
            r = self.c.post(url, {"email": email, "password": "not-the-password"}, format="json")
            self.assertEqual(r.status_code, 400, (url, email))
            self.assertEqual(r.data["detail"], "Incorrect email or password")
