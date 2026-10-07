from django.test import TestCase

# Create your tests here.


class DriverGenderPrivacyTests(TestCase):
    def test_gender_only_visible_to_the_driver(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver
        from drivers.serializers import DriverSerializer

        u = User.objects.create_user(phone="+233200000011", role="driver")
        d = Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        self.assertEqual(c.patch("/api/drivers/me", {"gender": "female"}, format="json").data["gender"], "female")
        self.assertNotIn("gender", DriverSerializer(Driver.objects.get(id=d.id)).data)


class AdminApplicationReviewTests(TestCase):
    """The desk needs the actual documents to review, not just text fields — this is the fix
    for licence_document silently never having been sent to admin at all."""

    def test_the_admin_list_includes_the_licence_photo_and_payout_details(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver, Vehicle

        applicant = User.objects.create_user(phone="+233200000011", name="Kofi", role="driver")
        driver = Driver.objects.create(user=applicant, licence_number="L1",
                                       licence_document="https://files.example.com/licence.jpg",
                                       payout_phone="+233209998888", payout_provider="hubtel")
        Vehicle.objects.create(driver=driver, plate_number="GT-1-24", photo="https://files.example.com/car.jpg",
                               registration_document="https://files.example.com/reg.pdf")
        admin = User.objects.create_user(phone="+233200000090", name="Ops", role="admin")
        c = APIClient(); c.force_authenticate(admin)
        row = c.get("/api/admin/drivers/pending").data[0]
        self.assertEqual(row["licence_document"], "https://files.example.com/licence.jpg")
        self.assertEqual(row["vehicles"][0]["photo"], "https://files.example.com/car.jpg")
        self.assertEqual(row["vehicles"][0]["registration_document"], "https://files.example.com/reg.pdf")
        self.assertEqual((row["payout_phone"], row["payout_provider"]), ("+233209998888", "hubtel"))


class PayoutSelfServiceTests(TestCase):
    """A verified rider can change where they're paid at any time, not only at application."""

    def test_a_driver_can_set_their_own_payout_phone_and_provider(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver

        u = User.objects.create_user(phone="+233200000011", role="driver")
        Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        r = c.patch("/api/drivers/me", {"payout_provider": "hubtel", "payout_phone": "0209998888"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["payout_phone"], r.data["payout_provider"]), ("+233209998888", "hubtel"))

    def test_a_bad_provider_is_rejected(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver

        u = User.objects.create_user(phone="+233200000012", role="driver")
        Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        self.assertEqual(c.patch("/api/drivers/me", {"payout_provider": "cash"}, format="json").status_code, 400)


# --- Rider passes + LI 2519 compliance --------------------------------------

from datetime import timedelta  # noqa: E402
from decimal import Decimal  # noqa: E402
from unittest import mock  # noqa: E402

from django.test import override_settings  # noqa: E402
from django.utils import timezone  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402


def _rider(phone="+233200000111", verified=True, compliant=True):
    from accounts.models import User
    from drivers.models import Driver, Vehicle

    u = User.objects.create_user(phone=phone, name="Yaw", role="driver")
    d = Driver.objects.create(
        user=u, licence_number="L-9",
        verification_status="verified" if verified else "pending",
        **({"ghana_card_number": f"GHA-{phone[-9:]}-1", "transport_union": "NUTO Tamale",
            "union_membership_number": "T-9"} if compliant else {}),
    )
    Vehicle.objects.create(driver=d, plate_number=f"NR-{phone[-4:]}-24",
                           roadworthy_expiry=(timezone.now() + timedelta(days=200)).date() if compliant else None)
    return d


def _plans():
    from drivers.models import RiderPassPlan

    return (RiderPassPlan.objects.create(name="Day pass", duration_days=1, price=Decimal("10.00")),
            RiderPassPlan.objects.create(name="Weekly pass", duration_days=7, price=Decimal("60.00")))


def _go_online(driver):
    c = APIClient(); c.force_authenticate(driver.user)
    return c.patch("/api/drivers/me/status", {"is_online": True}, format="json")


class GhanaCardTests(TestCase):
    def test_formats_are_normalized_and_bad_ones_refused(self):
        from django.core.exceptions import ValidationError

        from drivers.models import normalize_ghana_card

        self.assertEqual(normalize_ghana_card("gha 123456789 0"), "GHA-123456789-0")
        self.assertEqual(normalize_ghana_card("GHA1234567890"), "GHA-123456789-0")
        for bad in ("", "123456789-0", "GHA-12345-0", "XYZ-123456789-0"):
            with self.assertRaises(ValidationError):
                normalize_ghana_card(bad)

    def test_application_requires_li2519_details(self):
        from accounts.models import User

        u = User.objects.create_user(phone="+233200000120", role="passenger")
        c = APIClient(); c.force_authenticate(u)
        r = c.post("/api/drivers/apply", {"licence_number": "L-1", "plate_number": "NR-1-24"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("ghana_card_number", r.data)
        for optional in ("transport_union", "union_membership_number"):
            self.assertNotIn(optional, r.data)
        r = c.post("/api/drivers/apply", {"licence_number": "L-1", "plate_number": "NR-1-24",
                                          "ghana_card_number": "gha-123456789-0", "transport_union": "NUTO",
                                          "union_membership_number": "T-1", "roadworthy_expiry": "2027-06-30"},
                   format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["ghana_card_number"], "GHA-123456789-0")
        self.assertEqual(r.data["vehicles"][0]["roadworthy_expiry"], "2027-06-30")

    def test_one_ghana_card_per_rider(self):
        _rider("+233200000130")  # holds GHA-200000130-1
        other = _rider("+233200000131")
        c = APIClient(); c.force_authenticate(other.user)
        r = c.patch("/api/drivers/me", {"ghana_card_number": "GHA-200000130-1"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_ghana_card_never_reaches_non_private_serializer(self):
        from drivers.serializers import DriverSerializer

        d = _rider("+233200000132")
        self.assertNotIn("ghana_card_number", DriverSerializer(d).data)


class ComplianceVerifyTests(TestCase):
    def setUp(self):
        from accounts.models import User

        admin = User.objects.create_user(phone="+233200000190", role="admin")
        self.c = APIClient(); self.c.force_authenticate(admin)

    def test_verify_is_refused_until_documents_are_complete(self):
        d = _rider("+233200000140", verified=False, compliant=False)
        r = self.c.patch(f"/api/admin/drivers/{d.id}/verify", {"action": "verify"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["missing"], ["ghana_card_number"])
        d.refresh_from_db()
        self.assertEqual(d.verification_status, "pending")

    def test_override_verifies_and_is_audited(self):
        from core.models import AuditLog

        d = _rider("+233200000141", verified=False, compliant=False)
        r = self.c.patch(f"/api/admin/drivers/{d.id}/verify", {"action": "verify", "override": True}, format="json")
        self.assertEqual(r.status_code, 200)
        log = AuditLog.objects.get(action="driver.verify", target_id=str(d.id))
        self.assertIn("ghana_card_number", log.metadata["override_missing"])

    def test_complete_rider_verifies_normally(self):
        d = _rider("+233200000142", verified=False)
        r = self.c.patch(f"/api/admin/drivers/{d.id}/verify", {"action": "verify"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["compliance_missing"], [])


class RiderPassGateTests(TestCase):
    def test_off_by_default_nobody_is_blocked(self):
        self.assertEqual(_go_online(_rider()).status_code, 200)

    @override_settings(RIDER_PASS_REQUIRED=True, RIDER_PASS_TRIAL_DAYS=14)
    def test_trial_starts_on_first_go_online_then_never_again(self):
        from drivers.models import RiderPass
        from drivers.passes import expire_passes_and_enforce

        d = _rider()
        self.assertEqual(_go_online(d).status_code, 200)
        trial = RiderPass.objects.get(driver=d, source="trial")
        self.assertEqual((trial.expires_at - trial.starts_at).days, 14)
        # Trial ends: rider taken offline by the sweep, and no second trial.
        RiderPass.objects.filter(id=trial.id).update(expires_at=timezone.now() - timedelta(seconds=1))
        with mock.patch("drivers.services.take_driver_offline") as off:
            self.assertEqual(expire_passes_and_enforce(), 1)
            off.assert_called_once()
        self.assertEqual(RiderPass.objects.get(id=trial.id).status, "expired")
        r = _go_online(d)
        self.assertEqual(r.status_code, 403)
        self.assertIn("pass", r.data["detail"])

    @override_settings(RIDER_PASS_REQUIRED=True, RIDER_PASS_TRIAL_DAYS=0)
    def test_no_trial_configured_means_pay_first(self):
        self.assertEqual(_go_online(_rider()).status_code, 403)

    @override_settings(RIDER_PASS_REQUIRED=True, RIDER_PASS_TRIAL_DAYS=0)
    def test_unverified_rider_cannot_buy(self):
        day, _ = _plans()
        d = _rider(verified=False)
        c = APIClient(); c.force_authenticate(d.user)
        r = c.post("/api/drivers/me/passes", {"plan_id": str(day.id)}, format="json")
        self.assertEqual(r.status_code, 400)


@override_settings(RIDER_PASS_REQUIRED=True, RIDER_PASS_TRIAL_DAYS=0, MOMO_DEV_AUTO_APPROVE=True)
class RiderPassPurchaseTests(TestCase):
    def setUp(self):
        self.day, self.week = _plans()
        self.d = _rider()
        self.c = APIClient(); self.c.force_authenticate(self.d.user)

    def _buy(self, plan):
        r = self.c.post("/api/drivers/me/passes", {"plan_id": str(plan.id)}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["status"], "pending_payment")
        return self.c.post(f"/api/drivers/me/passes/{r.data['id']}/refresh").data

    def test_dev_momo_purchase_activates_and_unlocks_going_online(self):
        self.assertEqual(_go_online(self.d).status_code, 403)
        p = self._buy(self.day)
        self.assertEqual(p["status"], "active")
        self.assertEqual(_go_online(self.d).status_code, 200)

    def test_refresh_is_idempotent(self):
        first = self._buy(self.day)
        again = self.c.post(f"/api/drivers/me/passes/{first['id']}/refresh").data
        self.assertEqual(first["expires_at"], again["expires_at"])

    def test_second_pass_queues_after_the_first(self):
        first = self._buy(self.day)
        second = self._buy(self.week)
        self.assertEqual(second["starts_at"], first["expires_at"])
        status = self.c.get("/api/drivers/me/passes").data
        self.assertEqual(status["current"]["id"], first["id"])
        self.assertEqual(status["paid_until"], second["expires_at"])

    @override_settings(MOMO_DEV_AUTO_APPROVE=False)
    def test_unpaid_prompt_does_not_unlock(self):
        p = self._buy(self.day)
        self.assertEqual(p["status"], "pending_payment")
        self.assertEqual(_go_online(self.d).status_code, 403)

    def test_bad_plan_id_is_a_400_not_a_500(self):
        for bad in ("", "nope", "00000000-0000-0000-0000-000000000000"):
            r = self.c.post("/api/drivers/me/passes", {"plan_id": bad}, format="json")
            self.assertEqual(r.status_code, 400)

    def test_another_riders_pass_is_404(self):
        p = self._buy(self.day)
        other = _rider("+233200000150")
        c = APIClient(); c.force_authenticate(other.user)
        self.assertEqual(c.post(f"/api/drivers/me/passes/{p['id']}/refresh").status_code, 404)

    def test_momo_callback_activates(self):
        from drivers.models import RiderPass
        from payments.services import handle_momo_callback

        r = self.c.post("/api/drivers/me/passes", {"plan_id": str(self.day.id)}, format="json")
        handle_momo_callback(external_id=f"riderpass:{r.data['id']}")
        self.assertEqual(RiderPass.objects.get(id=r.data["id"]).status, "active")


@override_settings(RIDER_PASS_REQUIRED=True, RIDER_PASS_TRIAL_DAYS=0)
class AdminRiderPassTests(TestCase):
    def setUp(self):
        from accounts.models import User

        self.admin = User.objects.create_user(phone="+233200000191", role="admin")
        self.c = APIClient(); self.c.force_authenticate(self.admin)
        self.d = _rider()

    def test_create_and_reprice_plan(self):
        r = self.c.post("/api/admin/rider-passes/plans", {"name": "Day pass", "duration_days": 1, "price": "8"},
                        format="json")
        self.assertEqual(r.status_code, 201, r.data)
        r = self.c.patch(f"/api/admin/rider-passes/plans/{r.data['id']}", {"price": "7.50"}, format="json")
        self.assertEqual(r.data["price"], "7.50")
        for bad in ({"name": "x", "duration_days": 0, "price": 5}, {"name": "x", "duration_days": 1, "price": -1}):
            self.assertEqual(self.c.post("/api/admin/rider-passes/plans", bad, format="json").status_code, 400)

    def test_cash_pass_recorded_by_ops_unlocks_rider_and_is_audited(self):
        from core.models import AuditLog

        day, _ = _plans()
        r = self.c.post(f"/api/admin/drivers/{self.d.id}/passes", {"source": "cash", "plan_id": str(day.id)},
                        format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["price_paid"], "10.00")
        self.assertEqual(_go_online(self.d).status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="riderpass.cash", target_id=str(self.d.id)).exists())

    def test_grant_is_free_and_bounded(self):
        r = self.c.post(f"/api/admin/drivers/{self.d.id}/passes", {"source": "grant", "days": 3}, format="json")
        self.assertEqual((r.status_code, r.data["price_paid"]), (201, "0.00"))
        r = self.c.post(f"/api/admin/drivers/{self.d.id}/passes", {"source": "grant", "days": 365}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_riders_cannot_use_admin_pass_endpoints(self):
        c = APIClient(); c.force_authenticate(self.d.user)
        self.assertEqual(c.post(f"/api/admin/drivers/{self.d.id}/passes", {"source": "grant", "days": 30},
                                format="json").status_code, 403)

    def test_seed_command_prices_week_at_six_days(self):
        from django.core.management import call_command

        from drivers.models import RiderPassPlan

        call_command("seed_rider_passes", "--daily", "10", stdout=mock.MagicMock())
        self.assertEqual(RiderPassPlan.objects.get(name="Weekly pass").price, Decimal("60.00"))


class ComplianceSelfServiceTests(TestCase):
    def test_existing_rider_can_complete_missing_details(self):
        d = _rider("+233200000160", compliant=False)
        c = APIClient(); c.force_authenticate(d.user)
        r = c.patch("/api/drivers/me", {"ghana_card_number": "GHA 200000160 2", "transport_union": "NUTO Tamale",
                                        "union_membership_number": "T-160", "roadworthy_expiry": "2027-03-31"},
                    format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["compliance_missing"], [])
        self.assertEqual(r.data["ghana_card_number"], "GHA-200000160-2")

    def test_bad_inputs_rejected(self):
        d = _rider("+233200000161")
        c = APIClient(); c.force_authenticate(d.user)
        for body in ({"ghana_card_number": "123"}, {"roadworthy_expiry": "soon"},
                     {"union_card_document": "http://evil/x.jpg"}):
            self.assertEqual(c.patch("/api/drivers/me", body, format="json").status_code, 400, body)


class OptionalUnionAndRoadworthyTests(TestCase):
    def test_apply_and_verify_without_union_or_roadworthy(self):
        from accounts.models import User

        u = User.objects.create_user(phone="+233200000170", role="passenger")
        c = APIClient(); c.force_authenticate(u)
        r = c.post("/api/drivers/apply", {"licence_number": "L-7", "plate_number": "NR-170-24",
                                          "ghana_card_number": "GHA-200000170-3"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["compliance_missing"], [])
        admin = User.objects.create_user(phone="+233200000192", role="admin")
        a = APIClient(); a.force_authenticate(admin)
        r = a.patch(f"/api/admin/drivers/{r.data['id']}/verify", {"action": "verify"}, format="json")
        self.assertEqual((r.status_code, r.data["verification_status"]), (200, "verified"))
