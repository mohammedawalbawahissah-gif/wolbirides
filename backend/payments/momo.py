"""
MTN Mobile Money API client (ported from wr_rides, extended).

Two MTN products, each with its own subscription key and API user/key:
  - Collections   charge a passenger (request-to-pay, then poll or callback)
  - Disbursements pay a driver out (transfer, then poll or callback)

Everything is driven by settings (see .env.example). When a product's
credentials are missing, `enabled(product)` is False and callers fall back
to dev behaviour instead of calling MTN.

Tested with mocked HTTP matching MTN's documented shapes, not against MTN.
Run one real sandbox request-to-pay and one transfer before trusting it near
real money. Note: MTN's sandbox only accepts EUR; production uses GHS.
"""
import logging
import time
import uuid
from dataclasses import dataclass

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

COLLECTION = "collection"
DISBURSEMENT = "disbursement"


class MoMoError(Exception):
    """Any non-2xx from MTN, with status and body kept for the audit trail."""

    def __init__(self, message, status_code=None, body=None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


@dataclass
class Accepted:
    reference_id: str  # our X-Reference-Id; used to poll status and match callbacks


@dataclass
class CachedToken:
    """An OAuth access token from MTN and when it expires (epoch seconds)."""

    value: str = ""
    expires_at: float = 0.0


_token_cache = {COLLECTION: CachedToken(), DISBURSEMENT: CachedToken()}


def _creds(product):
    prefix = f"MOMO_{product.upper()}_"
    return (
        getattr(settings, prefix + "SUBSCRIPTION_KEY", ""),
        getattr(settings, prefix + "API_USER", ""),
        getattr(settings, prefix + "API_KEY", ""),
    )


def enabled(product=COLLECTION):
    return all(_creds(product))


def _base_url():
    return settings.MOMO_BASE_URL.rstrip("/")


def currency():
    return "EUR" if settings.MOMO_TARGET_ENVIRONMENT == "sandbox" else settings.MOMO_CURRENCY


def msisdn(phone):
    """MTN wants digits only with country code: '+233241234567' / '0241234567' -> '233241234567'."""
    from accounts.services import normalize_phone

    return normalize_phone(phone).lstrip("+")


def get_access_token(product=COLLECTION, force_refresh=False):
    """OAuth2 client-credentials, cached per product until ~60s before expiry."""
    cache = _token_cache[product]
    if not force_refresh and cache.value and time.time() < cache.expires_at - 60:
        return cache.value
    sub_key, api_user, api_key = _creds(product)
    resp = requests.post(
        f"{_base_url()}/{product}/token/",
        auth=(api_user, api_key),
        headers={"Ocp-Apim-Subscription-Key": sub_key},
        timeout=15,
    )
    if resp.status_code != 200:
        raise MoMoError(f"Couldn't get a MoMo {product} token", resp.status_code, resp.text)
    data = resp.json()
    cache.value = data["access_token"]
    cache.expires_at = time.time() + int(data.get("expires_in", 3600))
    return cache.value


def _headers(product, reference_id=None):
    sub_key, _, _ = _creds(product)
    headers = {
        "Ocp-Apim-Subscription-Key": sub_key,
        "Authorization": f"Bearer {get_access_token(product)}",
        "X-Target-Environment": settings.MOMO_TARGET_ENVIRONMENT,
    }
    if reference_id:
        headers["X-Reference-Id"] = reference_id
        headers["Content-Type"] = "application/json"
        if settings.MOMO_CALLBACK_URL:
            headers["X-Callback-Url"] = settings.MOMO_CALLBACK_URL
    return headers


def request_to_pay(*, amount, phone, external_id, payer_message="", payee_note=""):
    """Sends an approval prompt to the payer's phone. The outcome arrives later (poll or callback)."""
    reference_id = str(uuid.uuid4())
    payload = {
        "amount": str(amount),
        "currency": currency(),
        "externalId": str(external_id),
        "payer": {"partyIdType": "MSISDN", "partyId": msisdn(phone)},
        "payerMessage": payer_message[:160],
        "payeeNote": payee_note[:160],
    }
    resp = requests.post(f"{_base_url()}/collection/v1_0/requesttopay", json=payload,
                         headers=_headers(COLLECTION, reference_id), timeout=15)
    if resp.status_code != 202:
        raise MoMoError("MoMo didn't accept the payment request", resp.status_code, resp.text)
    return Accepted(reference_id)


def transfer(*, amount, phone, external_id, payer_message="", payee_note=""):
    """Sends money from the WolbiRides disbursement account to a driver's wallet."""
    reference_id = str(uuid.uuid4())
    payload = {
        "amount": str(amount),
        "currency": currency(),
        "externalId": str(external_id),
        "payee": {"partyIdType": "MSISDN", "partyId": msisdn(phone)},
        "payerMessage": payer_message[:160],
        "payeeNote": payee_note[:160],
    }
    resp = requests.post(f"{_base_url()}/disbursement/v1_0/transfer", json=payload,
                         headers=_headers(DISBURSEMENT, reference_id), timeout=15)
    if resp.status_code != 202:
        raise MoMoError("MoMo didn't accept the transfer", resp.status_code, resp.text)
    return Accepted(reference_id)


def get_status(product, reference_id):
    """MTN's raw status payload: {"status": "SUCCESSFUL" | "PENDING" | "FAILED", "reason": ..., ...}."""
    path = "requesttopay" if product == COLLECTION else "transfer"
    resp = requests.get(f"{_base_url()}/{product}/v1_0/{path}/{reference_id}", headers=_headers(product), timeout=15)
    if resp.status_code != 200:
        raise MoMoError(f"Couldn't read MoMo {product} status", resp.status_code, resp.text)
    return resp.json()


def reason_text(payload):
    reason = payload.get("reason")
    if isinstance(reason, dict):
        reason = reason.get("message") or reason.get("code")
    return {
        "APPROVAL_REJECTED": "The payment was declined on the phone.",
        "EXPIRED": "The payment prompt expired before it was approved.",
        "NOT_ENOUGH_FUNDS": "There isn't enough money in that MoMo wallet.",
        "PAYER_NOT_FOUND": "That number isn't registered for MoMo.",
        "PAYEE_NOT_FOUND": "That number isn't registered for MoMo.",
    }.get(str(reason), str(reason or "MoMo reported a failure."))
