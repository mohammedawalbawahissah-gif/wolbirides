"""
MoMo integration placeholder. The actual provider call (MTN MoMo Collections
API, per the pattern already built for LaafiTech) is intentionally not
wired in here — PRD Section 12 flags the licensed payment partner as an
open decision (WR-10.3: must be a Bank of Ghana-licensed/approved provider).

This module defines the seam so trips/views.py and the eventual provider
SDK call plug in without touching the Trip/Payment models again.
"""

import uuid

from django.conf import settings

from payments.models import Payment
from trips.models import Trip


def initiate_momo_payment(trip: Trip, phone: str) -> Payment:
    payment, _ = Payment.objects.update_or_create(
        trip=trip,
        defaults={
            "method": Payment.Method.MOMO,
            "amount": trip.fare_final or trip.fare_quote.total,
            "status": Payment.Status.PENDING,
            "provider_reference": f"pending-{uuid.uuid4().hex[:12]}",
        },
    )
    if settings.MOMO_API_KEY:
        # TODO: call the actual MoMo Collections "request to pay" endpoint
        # once the licensed provider is confirmed (WR-10.3 / PRD Section 12).
        pass
    else:
        print(f"[DEV MOMO] would charge {phone} {payment.amount} for trip {trip.id}, ref={payment.provider_reference}")
    return payment


def handle_momo_webhook(reference: str, status: str) -> Payment:
    payment = Payment.objects.get(provider_reference=reference)
    payment.status = Payment.Status.SUCCESS if status == "success" else Payment.Status.FAILED
    payment.save(update_fields=["status", "updated_at"])
    return payment


def record_cash_payment(trip: Trip) -> Payment:
    """
    Cash is the default MVP method (PRD Section 4.2). Recorded as
    'success' immediately since there's no async confirmation step —
    reconciliation happens manually by ops (WR-06.1) until the
    cash-commission mechanism from PRD Section 12 is resolved.
    """
    payment, _ = Payment.objects.update_or_create(
        trip=trip,
        defaults={
            "method": Payment.Method.CASH,
            "amount": trip.fare_final or trip.fare_quote.total,
            "status": Payment.Status.SUCCESS,
        },
    )
    return payment
