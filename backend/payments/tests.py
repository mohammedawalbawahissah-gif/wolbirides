from datetime import timedelta
"""MoMo collections, disbursements, cash confirmation and the callback, with MTN's HTTP mocked."""
from decimal import Decimal
from unittest import mock

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bundles.models import BundlePlan
from payments import hubtel, momo
from payments.models import Payment, Payout
from payments.services import (
    PaymentError, check_payout_status, disburse_payout, generate_payout_for_driver, initiate_hubtel_payment,
    initiate_momo_payment, record_cash_payment, refresh_payment_status,
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

    def test_only_passenger_can_start_momo(self):
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


LIVE_HUBTEL = dict(HUBTEL_CLIENT_ID="id", HUBTEL_CLIENT_SECRET="secret", HUBTEL_MERCHANT_ACCOUNT_NUMBER="123456",
                   HUBTEL_BASE_URL="https://rmp.hubtel.com")


class _Hubtel:
    """Just enough of Hubtel's placeholder API: charge (2xx) and status (200)."""

    def __init__(self, status="Success", reject=False):
        self.status, self.reject = status, reject
        self.posts = []

    def post(self, url, **kw):
        self.posts.append((url, kw))
        return _resp(400, text="bad") if self.reject else _resp(202)

    def get(self, url, **kw):
        return _resp(200, {"status": self.status})


@override_settings(**LIVE_HUBTEL)
class HubtelCollectionTests(_CompletedTripBase):
    def test_request_to_pay_shape_and_success(self):
        hb = _Hubtel()
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post), \
             mock.patch("payments.hubtel.requests.get", side_effect=hb.get):
            payment = initiate_hubtel_payment(self.trip, "0241234567")
            self.assertEqual(payment.status, Payment.Status.PENDING)
            payment = refresh_payment_status(payment)
        self.assertEqual(payment.status, Payment.Status.SUCCESS)
        self.assertEqual(payment.method, Payment.Method.HUBTEL)
        self.assertEqual(payment.funding_source, Payment.FundingSource.HUBTEL)
        url, kw = hb.posts[0]
        self.assertIn("merchantaccount/123456/receive/mobilemoney", url)
        self.assertEqual(kw["json"]["ClientReference"], payment.provider_reference)
        self.assertEqual(kw["json"]["Amount"], str(payment.amount))

    def test_hubtel_refusing_request_marks_failed_not_crash(self):
        hb = _Hubtel(reject=True)
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post):
            payment = initiate_hubtel_payment(self.trip, "0241234567")
        self.assertEqual(payment.status, Payment.Status.FAILED)

    def test_forged_hubtel_callback_cannot_mark_paid(self):
        hb = _Hubtel(status="Pending")
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post), \
             mock.patch("payments.hubtel.requests.get", side_effect=hb.get):
            payment = initiate_hubtel_payment(self.trip, "0241234567")
            r = APIClient().post("/api/payments/hubtel/webhook",
                                 {"externalId": f"trip:{payment.id}", "status": "Success"}, format="json")
        self.assertEqual(r.status_code, 200)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PENDING)  # Hubtel still says pending

    def test_genuine_hubtel_callback_settles_payment(self):
        hb = _Hubtel(status="Success")
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post), \
             mock.patch("payments.hubtel.requests.get", side_effect=hb.get):
            payment = initiate_hubtel_payment(self.trip, "0241234567")
            APIClient().post("/api/payments/hubtel/webhook", {"externalId": f"trip:{payment.id}"}, format="json")
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.SUCCESS)


class HubtelDevModeTests(_CompletedTripBase):
    def test_dev_mode_auto_approves_without_calling_hubtel(self):
        self.assertFalse(hubtel.enabled())
        payment = initiate_hubtel_payment(self.trip, "0241234567")
        self.assertTrue(payment.provider_reference.startswith("dev-"))
        payment = refresh_payment_status(payment)
        self.assertEqual(payment.status, Payment.Status.SUCCESS)

    @override_settings(HUBTEL_DEV_AUTO_APPROVE=False)
    def test_dev_mode_can_be_told_not_to_auto_approve(self):
        payment = initiate_hubtel_payment(self.trip, "0241234567")
        payment = refresh_payment_status(payment)
        self.assertEqual(payment.status, Payment.Status.PENDING)

    def test_only_passenger_can_start_hubtel(self):
        other = self.driver_a.user
        c = APIClient(); c.force_authenticate(other)
        r = c.post("/api/payments/hubtel/initiate", {"trip_id": str(self.trip.id), "phone": "0241234567"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_no_cash_after_hubtel_paid(self):
        initiate_hubtel_payment(self.trip, "0241234567")
        refresh_payment_status(Payment.objects.get(trip=self.trip))
        with self.assertRaises(PaymentError):
            record_cash_payment(self.trip)


@override_settings(**LIVE)
class PayoutDestinationTests(_CompletedTripBase):
    """A rider's own payout_phone/payout_provider decide where their money goes, not their
    account phone by default — this is the fix for the gap they had no way to set either at all."""

    def _payout(self):
        today = timezone.localdate()
        return Payout.objects.create(driver=self.driver_a, period_start=today - timedelta(days=7), period_end=today,
                                     amount=Decimal("42.50"), status=Payout.Status.APPROVED)

    def test_with_nothing_set_it_falls_back_to_the_account_phone_by_momo(self):
        self.assertEqual(self.driver_a.payout_destination(), (self.driver_a.user.phone, "momo"))
        mtn = _MTN()
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            payout = disburse_payout(self._payout())
        self.assertEqual(payout.provider, "momo")
        self.assertEqual(mtn.posts[-1][1]["json"]["payee"]["partyId"], self.driver_a.user.phone.lstrip("+"))

    def test_a_payout_phone_overrides_the_account_phone(self):
        self.driver_a.payout_phone = "+233209998888"
        self.driver_a.save()
        self.assertEqual(self.driver_a.payout_destination(), ("+233209998888", "momo"))
        mtn = _MTN()
        with mock.patch("payments.momo.requests.post", side_effect=mtn.post), \
             mock.patch("payments.momo.requests.get", side_effect=mtn.get):
            disburse_payout(self._payout())
        self.assertEqual(mtn.posts[-1][1]["json"]["payee"]["partyId"], "233209998888")

    @override_settings(**LIVE_HUBTEL)
    def test_choosing_hubtel_sends_the_payout_through_hubtel_not_momo(self):
        self.driver_a.payout_provider = "hubtel"
        self.driver_a.payout_phone = "0245555555"
        self.driver_a.save()
        hb = _Hubtel(status="Pending")
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post), \
             mock.patch("payments.hubtel.requests.get", side_effect=hb.get):
            payout = disburse_payout(self._payout())
            self.assertTrue(hb.posts[-1][0].endswith("/merchantaccount/123456/send/mobilemoney"))
            self.assertEqual(hb.posts[-1][1]["json"]["CustomerMsisdn"], "233245555555")
            self.assertEqual(payout.status, Payout.Status.PROCESSING)
            self.assertEqual(payout.provider, "hubtel")
            hb.status = "Success"
            self.assertEqual(check_payout_status(payout).status, Payout.Status.PAID)

    @override_settings(**LIVE_HUBTEL)
    def test_hubtel_refusing_the_transfer_marks_failed_for_retry(self):
        self.driver_a.payout_provider = "hubtel"
        self.driver_a.save()
        hb = _Hubtel(reject=True)
        with mock.patch("payments.hubtel.requests.post", side_effect=hb.post):
            payout = disburse_payout(self._payout())
        self.assertEqual(payout.status, Payout.Status.FAILED)
        self.assertEqual(payout.retry_count, 1)

    def test_setting_a_payout_method_at_application_is_optional_and_used_when_given(self):
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post("/api/drivers/apply", {
            "licence_number": "L-1", "plate_number": "GT-9999-24",
            "payout_phone": "0209998888", "payout_provider": "hubtel",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.driver_a.refresh_from_db()
        self.assertEqual((self.driver_a.payout_phone, self.driver_a.payout_provider), ("+233209998888", "hubtel"))

    def test_leaving_it_blank_at_application_keeps_the_account_phone_fallback(self):
        c = APIClient(); c.force_authenticate(self.driver_a.user)
        r = c.post("/api/drivers/apply", {"licence_number": "L-1", "plate_number": "GT-9999-24"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.driver_a.refresh_from_db()
        self.assertEqual((self.driver_a.payout_phone, self.driver_a.payout_provider), ("", "momo"))


class PayoutFundingSourceTests(_CompletedTripBase):
    """Every funding source that means the platform, not the driver, holds the fare must
    turn into a payout — a trip paid this way and then silently never paid out is a real loss."""

    def _paid_trip(self, method_setup):
        trip = self._request_trip_offered_to(self.driver_a)
        services.accept_trip(trip, self.driver_a)
        services.start_trip(Trip.objects.get(id=trip.id))
        trip = services.complete_trip(Trip.objects.get(id=trip.id))
        method_setup(trip)
        return trip

    def test_hubtel_trip_is_paid_out(self):
        trip = self._paid_trip(lambda t: initiate_hubtel_payment(t, "0241234567"))
        refresh_payment_status(Payment.objects.get(trip=trip))
        payout = generate_payout_for_driver(self.driver_a, trip.completed_at.date(), trip.completed_at.date() + timedelta(days=1))
        self.assertIn(str(trip.id), [item["trip_id"] for item in payout.line_items])

    def test_cash_trip_is_never_paid_out(self):
        trip = self._paid_trip(lambda t: record_cash_payment(t))
        payout = generate_payout_for_driver(self.driver_a, trip.completed_at.date(), trip.completed_at.date() + timedelta(days=1))
        self.assertNotIn(str(trip.id), [item["trip_id"] for item in payout.line_items])
