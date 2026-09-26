"""MoMo collections, disbursements, cash confirmation and the callback, with MTN's HTTP mocked."""
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bundles.models import BundlePlan
from payments import momo
from payments.models import Payment, Payout
from payments.services import (
    PaymentError, check_payout_status, disburse_payout, initiate_momo_payment, record_cash_payment,
    refresh_payment_status,
)
from trips import services
from trips.models import Trip
from trips.tests import DispatchTestBase

LIVE = dict(
    MOMO_COLLECTION_SUBSCRIPTION_KEY="sub", MOMO_COLLECTION_API_USER="user", MOMO_COLLECTION_API_KEY="key",
    MOMO_DISBURSEMENT_SUBSCRIPTION_KEY="dsub", MOMO_DISBURSEMENT_API_USER="duser", MOMO_DISBURSEMENT_API_KEY="dkey",
    MOMO_TARGET_ENVIRONMENT="sandbox", MOMO_BASE_URL="https://sandbox.momodeveloper.mtn.com",
)


def _resp(status, json=None, text=""):
    r = mock.Mock(status_code=status, text=text)
    r.json.return_value = json or {}
    return r


class _MTN:
    """Just enough of MTN's API: tokens, request-to-pay/transfer (202) and status (200)."""

    def __init__(self, status="SUCCESSFUL", reject=False, reason=None):
        self.status, self.reject, self.reason = status, reject, reason
        self.posts = []

    def post(self, url, **kw):
        self.posts.append((url, kw))
        if url.endswith("/token/"):
            return _resp(200, {"access_token": "tok", "expires_in": 3600})
        return _resp(400, text="bad") if self.reject else _resp(202)

    def get(self, url, **kw):
        body = {"status": self.status}
        if self.reason:
            body["reason"] = self.reason
        return _resp(200, body)


class _CompletedTripBase(DispatchTestBase):
    def setUp(self):
        super().setUp()
        momo._token_cache[momo.COLLECTION] = momo.CachedToken()
        momo._token_cache[momo.DISBURSEMENT] = momo.CachedToken()
        trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(trip, self.driver_a)
        services.start_trip(Trip.objects.get(id=trip.id))
        self.trip = services.complete_trip(Trip.objects.get(id=trip.id))


@override_settings(**LIVE)
class CollectionTests(_CompletedTripBase):
    def test_request_to_pay_shape_and_success(self):
        mtn = _MTN()
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payment = initiate_momo_payment(self.trip, "0241234567")
            self.assertEqual(payment.status, Payment.Status.PENDING)
            url, kw = mtn.posts[-1]
            self.assertTrue(url.endswith("/collection/v1_0/requesttopay"))
            self.assertEqual(kw["json"]["payer"]["partyId"], "233241234567")  # digits only, country code
            self.assertEqual(kw["json"]["currency"], "EUR")  # sandbox
            self.assertEqual(kw["headers"]["X-Reference-Id"], payment.provider_reference)
            refresh_payment_status(payment)
        self.assertEqual(payment.status, Payment.Status.SUCCESS)

    def test_token_is_cached(self):
        mtn = _MTN()
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post):
            momo.get_access_token(); momo.get_access_token()
        self.assertEqual(sum(1 for u, _ in mtn.posts if u.endswith("/token/")), 1)

    def test_rejection_on_phone_gives_readable_reason(self):
        mtn = _MTN(status="FAILED", reason="APPROVAL_REJECTED")
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payment = refresh_payment_status(initiate_momo_payment(self.trip, "0241234567"))
        self.assertEqual(payment.status, Payment.Status.FAILED)
        self.assertIn("declined", payment.failure_reason)

    def test_mtn_refusing_request_marks_failed_not_crash(self):
        mtn = _MTN(reject=True)
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post):
            payment = initiate_momo_payment(self.trip, "0241234567")
        self.assertEqual(payment.status, Payment.Status.FAILED)

    def test_forged_callback_cannot_mark_paid(self):
        mtn = _MTN(status="PENDING")
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payment = initiate_momo_payment(self.trip, "0241234567")
            r = APIClient().post("/api/payments/momo/webhook",
                                 {"externalId": f"trip:{payment.id}", "status": "SUCCESSFUL"}, format="json")
        self.assertEqual(r.status_code, 200)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PENDING)  # MTN still says pending

    def test_genuine_callback_settles_payment(self):
        mtn = _MTN(status="SUCCESSFUL")
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payment = initiate_momo_payment(self.trip, "0241234567")
            APIClient().post("/api/payments/momo/webhook", {"externalId": f"trip:{payment.id}"}, format="json")
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.SUCCESS)

    def test_bundle_momo_purchase_activates_on_success(self):
        plan = BundlePlan.objects.create(name="Campus 10", ride_count=10, price=Decimal("80"), max_fare_per_ride=Decimal("15"))
        mtn = _MTN()
        client = APIClient(); client.force_authenticate(self.passenger)
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            r = client.post("/api/ride-bundles/purchase", {"plan_id": str(plan.id), "payment_method": "momo",
                                                      "phone": "0241234567"}, format="json")
            self.assertEqual(r.data["status"], "pending_payment")
            r = client.get(f"/api/bundles/{r.data['id']}/payment-status")
        self.assertEqual(r.data["status"], "active")


class PaymentRulesTests(_CompletedTripBase):
    def test_cannot_pay_before_completion(self):
        trip = self._request_trip_offered_to(self.driver_b)
        with self.assertRaises(PaymentError):
            initiate_momo_payment(trip, "0241234567")

    @override_settings(MOMO_DEV_AUTO_APPROVE=True)
    def test_dev_mode_flow_without_credentials(self):
        payment = refresh_payment_status(initiate_momo_payment(self.trip, "0241234567"))
        self.assertEqual(payment.status, Payment.Status.SUCCESS)

    def test_driver_confirms_cash(self):
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post("/api/payments/cash/confirm", {"trip_id": str(self.trip.id)}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Payment.objects.get(trip=self.trip).method, "cash")

    @override_settings(MOMO_DEV_AUTO_APPROVE=True)
    def test_no_cash_after_momo_paid(self):
        refresh_payment_status(initiate_momo_payment(self.trip, "0241234567"))
        with self.assertRaises(PaymentError):
            record_cash_payment(self.trip)

    def test_only_rider_can_start_momo(self):
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post("/api/payments/momo/initiate", {"trip_id": str(self.trip.id), "phone": "0241234567"}, format="json")
        self.assertEqual(r.status_code, 403)


@override_settings(**LIVE)
class DisbursementTests(_CompletedTripBase):
    def _payout(self):
        today = timezone.localdate()
        return Payout.objects.create(driver=self.driver_a, period_start=today - timedelta(days=7), period_end=today,
                                     amount=Decimal("42.50"), status=Payout.Status.APPROVED)

    def test_transfer_goes_processing_then_paid(self):
        mtn = _MTN(status="PENDING")
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payout = disburse_payout(self._payout())
            url, kw = mtn.posts[-1]
            self.assertTrue(url.endswith("/disbursement/v1_0/transfer"))
            self.assertEqual(kw["json"]["payee"]["partyId"], self.driver_a.user.phone.lstrip("+"))
            self.assertEqual(payout.status, Payout.Status.PROCESSING)
            self.assertEqual(check_payout_status(payout).status, Payout.Status.PROCESSING)
            mtn.status = "SUCCESSFUL"
            self.assertEqual(check_payout_status(payout).status, Payout.Status.PAID)
        self.assertTrue(self.driver_a.user.notifications.filter(category="payout").exists())

    def test_rejected_transfer_marks_failed_for_retry(self):
        mtn = _MTN(reject=True)
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post):
            payout = disburse_payout(self._payout())
        self.assertEqual(payout.status, Payout.Status.FAILED)
        self.assertEqual(payout.retry_count, 1)
