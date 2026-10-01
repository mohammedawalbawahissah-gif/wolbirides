"""
Hubtel payment client (passenger collections only; driver payouts stay on MTN MoMo).

IMPORTANT: unlike payments/momo.py, this client has NOT been checked against
Hubtel's real API. Hubtel's public "Receive Money" (merchant Direct Debit)
product is typically: Basic Auth with a client id/secret, a merchant account
number, POST to a checkout/charge endpoint, then a callback plus a status
poll. The request/response field names below follow that shape but must be
confirmed against Hubtel's current documentation and a live merchant account
before this goes anywhere near real money — treat every field name here as a
placeholder, the same way MomoWebhookSerializer's docstring flags its shape
as provisional until a licensed partner is confirmed (PRD Section 12).

When HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET / HUBTEL_MERCHANT_ACCOUNT_NUMBER
are unset, `enabled()` is False and callers fall back to dev behaviour
instead of calling Hubtel, exactly like the MoMo client.
"""
import logging
import uuid
from dataclasses import dataclass

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class HubtelError(Exception):
    """Any non-2xx from Hubtel, with status and body kept for the audit trail."""

    def __init__(self, message, status_code=None, body=None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


@dataclass
class Accepted:
    reference_id: str  # our clientReference; used to poll status and match callbacks


def enabled():
    return bool(settings.HUBTEL_CLIENT_ID and settings.HUBTEL_CLIENT_SECRET and settings.HUBTEL_MERCHANT_ACCOUNT_NUMBER)


def _base_url():
    return settings.HUBTEL_BASE_URL.rstrip("/")


def msisdn(phone):
    """Hubtel wants digits only with country code, same convention as MoMo."""
    from accounts.services import normalize_phone

    return normalize_phone(phone).lstrip("+")


def request_to_pay(*, amount, phone, external_id, description=""):
    """Sends a mobile money charge prompt to the payer's phone. The outcome arrives later (poll or callback)."""
    reference_id = str(uuid.uuid4())
    payload = {
        "CustomerName": "WolbiRides passenger",
        "CustomerMsisdn": msisdn(phone),
        "Channel": "mtn-gh",  # placeholder network code — confirm against the payer's actual network
        "Amount": str(amount),
        "PrimaryCallbackUrl": settings.HUBTEL_CALLBACK_URL or None,
        "Description": description[:100],
        "ClientReference": reference_id,
    }
    resp = requests.post(
        f"{_base_url()}/merchantaccount/{settings.HUBTEL_MERCHANT_ACCOUNT_NUMBER}/receive/mobilemoney",
        json=payload, auth=(settings.HUBTEL_CLIENT_ID, settings.HUBTEL_CLIENT_SECRET), timeout=15,
    )
    if resp.status_code not in (200, 201, 202):
        raise HubtelError("Hubtel didn't accept the payment request", resp.status_code, resp.text)
    return Accepted(reference_id)


def transfer(*, amount, phone, external_id, payer_message=""):
    """Sends money from WolbiRides to a rider's wallet — the disbursement side of the placeholder
    "Direct Receive Money" shape this module already uses for collections (see the module
    docstring). Hubtel's real disbursement product ("Send Money") has NOT been checked against
    this shape at all — treat every field name here as a guess to confirm before going live,
    exactly like request_to_pay."""
    reference_id = str(uuid.uuid4())
    payload = {
        "CustomerMsisdn": msisdn(phone),
        "Channel": "mtn-gh",  # placeholder network code — confirm against the payee's actual network
        "Amount": str(amount),
        "PrimaryCallbackUrl": settings.HUBTEL_CALLBACK_URL or None,
        "Description": payer_message[:100],
        "ClientReference": reference_id,
    }
    resp = requests.post(
        f"{_base_url()}/merchantaccount/{settings.HUBTEL_MERCHANT_ACCOUNT_NUMBER}/send/mobilemoney",
        json=payload, auth=(settings.HUBTEL_CLIENT_ID, settings.HUBTEL_CLIENT_SECRET), timeout=15,
    )
    if resp.status_code not in (200, 201, 202):
        raise HubtelError("Hubtel didn't accept the transfer", resp.status_code, resp.text)
    return Accepted(reference_id)


def get_status(reference_id):
    """Hubtel's raw status payload, expected to include a top-level status string."""
    resp = requests.get(
        f"{_base_url()}/merchantaccount/{settings.HUBTEL_MERCHANT_ACCOUNT_NUMBER}/transactions/status",
        params={"clientReference": reference_id},
        auth=(settings.HUBTEL_CLIENT_ID, settings.HUBTEL_CLIENT_SECRET), timeout=15,
    )
    if resp.status_code != 200:
        raise HubtelError("Couldn't read Hubtel status", resp.status_code, resp.text)
    return resp.json()


def reason_text(payload):
    status = str(payload.get("status") or payload.get("Status") or "")
    return {
        "Failed": "The payment was declined.",
        "Cancelled": "The payment prompt was cancelled.",
        "Unknown": "Hubtel couldn't confirm the payment.",
    }.get(status, "Hubtel reported a failure.")

