"""
Payments: MoMo collections for trips and bundles, cash confirmation, and
MoMo disbursements for driver payouts. Provider calls live in payments/momo.py.
"""

import logging
import uuid

from django.conf import settings

from payments import hubtel, momo
from payments.models import Payment
from trips.models import Trip

logger = logging.getLogger(__name__)


class PaymentError(ValueError):
    """A payment action that isn't allowed for this trip, with passenger-facing text."""


def _payable_amount(trip):
    return trip.fare_final or trip.pool_seat_fare or trip.fare_quote.total


def initiate_momo_payment(trip: Trip, phone: str) -> Payment:
    """Pay-after-trip: sends a MoMo approval prompt to the passenger's phone."""
    if trip.status != Trip.Status.COMPLETED:
        raise PaymentError("You can pay once the trip is complete.")
    if trip.payment_method in (Trip.PaymentMethod.ORGANIZATION, Trip.PaymentMethod.VOUCHER, Trip.PaymentMethod.BUNDLE):
        raise PaymentError("This trip is already paid for.")
    existing = Payment.objects.filter(trip=trip).first()
    if existing and existing.status == Payment.Status.SUCCESS:
        raise PaymentError("This trip is already paid for.")

    amount = _payable_amount(trip)
    payment, _ = Payment.objects.update_or_create(
        trip=trip,
        defaults={"method": Payment.Method.MOMO, "funding_source": Payment.FundingSource.MOMO,
                  "amount": amount, "status": Payment.Status.PENDING,
                  "payer_phone": phone, "failure_reason": "", "provider_status": "", "confirmed_by": ""},
    )
    if not momo.enabled(momo.COLLECTION):
        payment.provider_reference = f"dev-{uuid.uuid4().hex[:12]}"
        payment.save(update_fields=["provider_reference", "updated_at"])
        logger.info("[DEV MOMO] would charge %s GH₵%s for trip %s", phone, amount, trip.id)
        return payment
    try:
        accepted = momo.request_to_pay(
            amount=amount, phone=phone, external_id=f"trip:{payment.id}",
            payer_message="WolbiRides trip", payee_note=f"Trip {str(trip.id)[:8]}",
        )
    except momo.MoMoError as exc:
        logger.warning("MoMo request-to-pay failed for trip %s: %s %s", trip.id, exc.status_code, exc.body)
        payment.status = Payment.Status.FAILED
        payment.failure_reason = "MoMo couldn't start the payment. Check the number and try again, or pay cash."
        payment.save(update_fields=["status", "failure_reason", "updated_at"])
        return payment
    payment.provider_reference = accepted.reference_id
    payment.save(update_fields=["provider_reference", "updated_at"])
    return payment


def initiate_hubtel_payment(trip: Trip, phone: str) -> Payment:
    """Pay-after-trip: sends a Hubtel mobile money charge prompt to the passenger's phone."""
    if trip.status != Trip.Status.COMPLETED:
        raise PaymentError("You can pay once the trip is complete.")
    if trip.payment_method in (Trip.PaymentMethod.ORGANIZATION, Trip.PaymentMethod.VOUCHER, Trip.PaymentMethod.BUNDLE):
        raise PaymentError("This trip is already paid for.")
    existing = Payment.objects.filter(trip=trip).first()
    if existing and existing.status == Payment.Status.SUCCESS:
        raise PaymentError("This trip is already paid for.")

    amount = _payable_amount(trip)
    payment, _ = Payment.objects.update_or_create(
        trip=trip,
        defaults={"method": Payment.Method.HUBTEL, "funding_source": Payment.FundingSource.HUBTEL,
                  "amount": amount, "status": Payment.Status.PENDING,
                  "payer_phone": phone, "failure_reason": "", "provider_status": "", "confirmed_by": ""},
    )
    if not hubtel.enabled():
        payment.provider_reference = f"dev-{uuid.uuid4().hex[:12]}"
        payment.save(update_fields=["provider_reference", "updated_at"])
        logger.info("[DEV HUBTEL] would charge %s GH₵%s for trip %s", phone, amount, trip.id)
        return payment
    try:
        accepted = hubtel.request_to_pay(amount=amount, phone=phone, external_id=f"trip:{payment.id}",
                                         description=f"WolbiRides trip {str(trip.id)[:8]}")
    except hubtel.HubtelError as exc:
        logger.warning("Hubtel charge failed for trip %s: %s %s", trip.id, exc.status_code, exc.body)
        payment.status = Payment.Status.FAILED
        payment.failure_reason = "Hubtel couldn't start the payment. Check the number and try again, or pay cash."
        payment.save(update_fields=["status", "failure_reason", "updated_at"])
        return payment
    payment.provider_reference = accepted.reference_id
    payment.save(update_fields=["provider_reference", "updated_at"])
    return payment


def refresh_payment_status(payment: Payment) -> Payment:
    """Asks the provider for the outcome of a pending MoMo/Hubtel payment (the passenger's app polls this)."""
    if payment.method not in (Payment.Method.MOMO, Payment.Method.HUBTEL) or payment.status != Payment.Status.PENDING:
        return payment
    if payment.method == Payment.Method.HUBTEL:
        if not hubtel.enabled():
            if settings.HUBTEL_DEV_AUTO_APPROVE:
                _apply_collection_status(payment, {"status": "Success"})
            return payment
        try:
            _apply_collection_status(payment, hubtel.get_status(payment.provider_reference))
        except hubtel.HubtelError as exc:
            logger.warning("Hubtel status check failed for payment %s: %s", payment.id, exc)
        return payment
    if not momo.enabled(momo.COLLECTION):
        if settings.MOMO_DEV_AUTO_APPROVE:
            _apply_collection_status(payment, {"status": "SUCCESSFUL"})
        return payment
    try:
        _apply_collection_status(payment, momo.get_status(momo.COLLECTION, payment.provider_reference))
    except momo.MoMoError as exc:
        logger.warning("MoMo status check failed for payment %s: %s", payment.id, exc)
    return payment


def _apply_collection_status(payment, payload):
    raw = payload.get("status", "")
    payment.provider_status = raw
    if raw in ("SUCCESSFUL", "Success"):
        payment.status = Payment.Status.SUCCESS
        payment.failure_reason = ""
    elif raw in ("FAILED", "REJECTED", "TIMEOUT", "Failed", "Cancelled", "Unknown"):
        payment.status = Payment.Status.FAILED
        reason_fn = hubtel.reason_text if payment.method == Payment.Method.HUBTEL else momo.reason_text
        payment.failure_reason = reason_fn(payload)
    payment.save(update_fields=["status", "provider_status", "failure_reason", "updated_at"])
    if payment.status == Payment.Status.SUCCESS:
        _log_trip_event(payment.trip, "payment_succeeded", {"method": payment.method, "amount": str(payment.amount)})
        from trips.services import _broadcast_trip_update

        _broadcast_trip_update(payment.trip)


def record_cash_payment(trip: Trip, confirmed_by="driver") -> Payment:
    """The driver confirms they received cash. Refused if the trip was already paid another way."""
    if trip.status != Trip.Status.COMPLETED:
        raise PaymentError("Confirm cash once the trip is complete.")
    existing = Payment.objects.filter(trip=trip).first()
    if trip.payment_method in (Trip.PaymentMethod.ORGANIZATION, Trip.PaymentMethod.VOUCHER, Trip.PaymentMethod.BUNDLE) or (
        existing and existing.status == Payment.Status.SUCCESS and existing.method != Payment.Method.CASH
    ):
        raise PaymentError("This trip is already paid. Don't collect cash.")
    payment, _ = Payment.objects.update_or_create(
        trip=trip,
        defaults={"method": Payment.Method.CASH, "funding_source": Payment.FundingSource.CASH,
                  "amount": _payable_amount(trip), "status": Payment.Status.SUCCESS,
                  "confirmed_by": confirmed_by, "failure_reason": ""},
    )
    _log_trip_event(trip, "payment_succeeded", {"method": "cash", "amount": str(payment.amount)})
    return payment


def handle_momo_callback(reference_id: str = "", external_id: str = ""):
    """
    MTN's callback is unauthenticated, so its body is never trusted: we only
    use it to find *which* transaction changed, then ask MTN directly.
    """
    return _handle_provider_callback(reference_id, external_id)


def handle_hubtel_callback(reference_id: str = "", external_id: str = ""):
    """Same hardening as handle_momo_callback: the body only identifies the transaction;
    the outcome is always re-read from Hubtel directly."""
    return _handle_provider_callback(reference_id, external_id)


def _handle_provider_callback(reference_id: str = "", external_id: str = ""):
    from bundles.models import PassengerBundle
    from payments.models import Payout

    kind, _, obj_id = (external_id or "").partition(":")
    if kind == "trip" or (not kind and reference_id):
        payment = Payment.objects.filter(id=obj_id).first() if kind == "trip" else \
            Payment.objects.filter(provider_reference=reference_id).first()
        return refresh_payment_status(payment) if payment else None
    if kind == "bundle":
        bundle = PassengerBundle.objects.filter(id=obj_id).first()
        return refresh_bundle_payment(bundle) if bundle else None
    if kind == "payout":
        payout = Payout.objects.filter(id=obj_id).first()
        return check_payout_status(payout) if payout else None
    return None





def _log_trip_event(trip, event_type, payload):
    from trips.models import TripEvent

    TripEvent.objects.create(trip=trip, event_type=event_type, payload=payload)


# --- WR-22: paying for a bundle with MoMo ------------------------------------

def start_bundle_momo_payment(bundle, phone):
    from bundles.models import PassengerBundle

    if bundle.status != PassengerBundle.Status.PENDING_PAYMENT:
        raise PaymentError("This bundle isn't waiting for payment.")
    bundle.payment_method = "momo"
    if not momo.enabled(momo.COLLECTION):
        bundle.payment_reference = f"dev-{uuid.uuid4().hex[:12]}"
        bundle.save(update_fields=["payment_method", "payment_reference", "updated_at"])
        logger.info("[DEV MOMO] would charge %s GH₵%s for bundle %s", phone, bundle.price_paid, bundle.id)
        return bundle
    accepted = momo.request_to_pay(
        amount=bundle.price_paid, phone=phone, external_id=f"bundle:{bundle.id}",
        payer_message=f"WolbiRides {bundle.plan.name}", payee_note=f"Bundle {str(bundle.id)[:8]}",
    )
    bundle.payment_reference = accepted.reference_id
    bundle.save(update_fields=["payment_method", "payment_reference", "updated_at"])
    return bundle


def refresh_bundle_payment(bundle):
    from bundles.models import PassengerBundle
    from bundles.services import activate

    if bundle.status != PassengerBundle.Status.PENDING_PAYMENT or bundle.payment_method != "momo" \
            or not bundle.payment_reference:
        return bundle
    if not momo.enabled(momo.COLLECTION):
        payload = {"status": "SUCCESSFUL"} if settings.MOMO_DEV_AUTO_APPROVE else {"status": "PENDING"}
    else:
        try:
            payload = momo.get_status(momo.COLLECTION, bundle.payment_reference)
        except momo.MoMoError as exc:
            logger.warning("MoMo status check failed for bundle %s: %s", bundle.id, exc)
            return bundle
    if payload.get("status") == "SUCCESSFUL":
        return activate(bundle, payment_reference=bundle.payment_reference)
    if payload.get("status") in ("FAILED", "REJECTED", "TIMEOUT"):
        # Leave it pending so the passenger can try again; clear the dead reference.
        bundle.payment_reference = ""
        bundle.save(update_fields=["payment_reference", "updated_at"])
    return bundle


# --- WR-14: automated weekly driver payouts ---------------------------------

# Money WolbiRides collected on the driver's behalf and therefore owes them,
# by who actually paid (Payment.funding_source). Cash is excluded: the driver
# already holds that fare.
PAYOUT_FUNDING_SOURCES = [
    Payment.FundingSource.MOMO, Payment.FundingSource.HUBTEL, Payment.FundingSource.ORGANIZATION_ACCOUNT,
    Payment.FundingSource.ORGANIZATION_VOUCHER, Payment.FundingSource.RIDE_BUNDLE,
]

def generate_payout_for_driver(driver, period_start, period_end):
    """
    Builds (but does not disburse) one Payout covering every completed trip in
    [period_start, period_end) for this driver paid through PAYOUT_FUNDING_SOURCES
    (MoMo, Hubtel, an organization account or voucher, or a ride bundle).

    IMPORTANT: cash trips are deliberately excluded. Cash is collected by
    the driver directly from the passenger at the time of the ride — the
    driver already has that money in hand. Including cash trips here
    would pay the driver a second time for fares they've already
    collected in person. Only trips where the platform, not the driver,
    received the fare create money the platform owes back to the driver.

    This does mean commission on cash trips isn't collected anywhere yet
    — that's the same open question PRD Section 12 already flagged
    ("cash-trip commission mechanism still needs a field-validated
    answer") and is out of scope for this payout system specifically;
    it would need a separate "amount owed to platform" ledger rather
    than a payout, since the direction of money owed is reversed.

    Idempotent per (driver, period): re-running for a period that
    already has a non-failed Payout returns the existing one rather than
    creating a duplicate.
    """
    from decimal import Decimal

    from payments.models import Payout
    from trips.models import Trip

    existing = Payout.objects.filter(
        driver=driver, period_start=period_start, period_end=period_end
    ).exclude(status=Payout.Status.FAILED).first()
    if existing:
        return existing

    trips = (
        Trip.objects.filter(
            driver=driver,
            status=Trip.Status.COMPLETED,
            completed_at__date__gte=period_start,
            completed_at__date__lt=period_end,
            payment__status=Payment.Status.SUCCESS,
            payment__funding_source__in=PAYOUT_FUNDING_SOURCES,
        )
        .select_related("payment")
        .order_by("completed_at")
    )

    commission_rate = Decimal(str(settings.DEFAULT_DRIVER_COMMISSION_RATE))
    line_items = []
    total_net = Decimal("0.00")

    for trip in trips:
        fare = trip.fare_final or trip.payment.amount
        commission = (fare * commission_rate).quantize(Decimal("0.01"))
        net = fare - commission
        total_net += net
        line_items.append({
            "trip_id": str(trip.id),
            "completed_at": trip.completed_at.isoformat() if trip.completed_at else None,
            "fare": str(fare),
            "commission": str(commission),
            "net": str(net),
        })

    return Payout.objects.create(
        driver=driver,
        period_start=period_start,
        period_end=period_end,
        amount=total_net,
        commission_rate_snapshot=commission_rate,
        line_items=line_items,
        status=Payout.Status.PENDING,
    )


def generate_weekly_payouts(period_start, period_end):
    """
    Generates one Payout per driver who completed at least one paid trip
    in the period. Drivers with zero completed trips simply get no Payout
    row for that period — nothing to disburse, nothing to show.
    """
    from drivers.models import Driver
    from trips.models import Trip

    driver_ids = (
        Trip.objects.filter(
            status=Trip.Status.COMPLETED,
            completed_at__date__gte=period_start,
            completed_at__date__lt=period_end,
            payment__status=Payment.Status.SUCCESS,
            payment__funding_source__in=PAYOUT_FUNDING_SOURCES,
        )
        .values_list("driver_id", flat=True)
        .distinct()
    )
    payouts = []
    for driver in Driver.objects.filter(id__in=driver_ids):
        payouts.append(generate_payout_for_driver(driver, period_start, period_end))
    return payouts


def disburse_payout(payout):
    """
    Sends an approved payout to the driver's MoMo wallet. MTN accepts the
    transfer immediately and settles it asynchronously, so a successful call
    leaves the payout PROCESSING until check_payout_status (polled by Celery,
    or triggered by MTN's callback) sees the final result.
    """
    from payments.models import Payout

    if payout.amount <= 0:
        payout.status = Payout.Status.PAID
        payout.provider_reference = "zero-amount-noop"
        payout.save(update_fields=["status", "provider_reference", "updated_at"])
        return payout

    from payments import hubtel

    phone, provider = payout.driver.payout_destination()
    payout.provider = provider
    if provider == "hubtel":
        enabled, transfer_fn, error_cls = hubtel.enabled(), hubtel.transfer, hubtel.HubtelError
        kwargs = {"payer_message": "WolbiRides weekly payout"}
    else:
        enabled, transfer_fn, error_cls = momo.enabled(momo.DISBURSEMENT), momo.transfer, momo.MoMoError
        kwargs = {"payer_message": "WolbiRides weekly payout", "payee_note": f"{payout.period_start} to {payout.period_end}"}

    if not enabled:
        logger.info("[DEV %s PAYOUT] would pay %s GH₵%s", provider.upper(), phone, payout.amount)
        payout.provider_reference = f"dev-{uuid.uuid4().hex[:12]}"
        return _finish_payout(payout, succeeded=True)

    try:
        accepted = transfer_fn(amount=payout.amount, phone=phone, external_id=f"payout:{payout.id}", **kwargs)
    except error_cls as exc:
        logger.warning("%s transfer failed for payout %s: %s %s", provider, payout.id, getattr(exc, "status_code", None), getattr(exc, "body", exc))
        payout.retry_count += 1
        payout.failure_reason = f"{'MoMo' if provider == 'momo' else 'Hubtel'} didn't accept the transfer. Will retry."
        payout.status = Payout.Status.FAILED
        payout.save(update_fields=["status", "failure_reason", "retry_count", "updated_at"])
        return payout

    payout.provider_reference = accepted.reference_id
    payout.status = Payout.Status.PROCESSING
    payout.failure_reason = ""
    payout.save(update_fields=["status", "provider", "provider_reference", "failure_reason", "updated_at"])
    return payout


def check_payout_status(payout):
    from payments import hubtel
    from payments.models import Payout

    if payout.status != Payout.Status.PROCESSING:
        return payout
    is_hubtel = payout.provider == "hubtel"
    try:
        if is_hubtel:
            payload = hubtel.get_status(payout.provider_reference)
        else:
            payload = momo.get_status(momo.DISBURSEMENT, payout.provider_reference)
    except hubtel.HubtelError as exc:
        logger.warning("Hubtel transfer status failed for payout %s: %s", payout.id, exc)
        return payout
    except momo.MoMoError as exc:
        logger.warning("MoMo transfer status failed for payout %s: %s", payout.id, exc)
        return payout
    raw = payload.get("status") or payload.get("Status") or ""
    if raw in ("SUCCESSFUL", "Success"):
        return _finish_payout(payout, succeeded=True)
    if raw in ("FAILED", "REJECTED", "Failed", "Cancelled"):
        payout.failure_reason = hubtel.reason_text(payload) if is_hubtel else momo.reason_text(payload)
        return _finish_payout(payout, succeeded=False)
    return payout


def _finish_payout(payout, succeeded):
    from core.models import Notification, notify
    from payments.models import Payout

    if succeeded:
        payout.status = Payout.Status.PAID
        payout.failure_reason = ""
    else:
        payout.status = Payout.Status.FAILED
        payout.retry_count += 1
    payout.save(update_fields=["status", "provider_reference", "failure_reason", "retry_count", "updated_at"])
    if succeeded:
        notify(payout.driver.user, title="Payout sent",
               body=f"GH₵{payout.amount} for {payout.period_start} to {payout.period_end} is in your MoMo wallet.",
               category=Notification.Category.PAYOUT, link="/earnings")
    return payout
