import hashlib
import random

from django.conf import settings
from django.utils import timezone

from accounts.models import OTPRequest, User

OTP_TTL_MINUTES = 5
OTP_MAX_ATTEMPTS = 5


def _hash_code(code):
    return hashlib.sha256(code.encode()).hexdigest()


def request_otp(phone):
    code = f"{random.randint(0, 999999):06d}"
    OTPRequest.objects.create(
        phone=phone,
        code_hash=_hash_code(code),
        expires_at=timezone.now() + timezone.timedelta(minutes=OTP_TTL_MINUTES),
    )
    _send_sms(phone, f"Your WolbiRides verification code is {code}. It expires in {OTP_TTL_MINUTES} minutes.")


def _send_sms(phone, message):
    """
    Thin wrapper around Africa's Talking, matching the env var names used
    across NeoMatCare/FarmAsyst (AFRICASTALKING_USERNAME/API_KEY) — the
    earlier NeoMatCare incident (AT_USERNAME vs AFRICASTALKING_USERNAME
    mismatch) is exactly why these names are pinned here explicitly.
    """
    if not settings.AFRICASTALKING_USERNAME:
        # Local/dev fallback — log instead of sending.
        print(f"[DEV OTP] to {phone}: {message}")
        return
    import africastalking

    africastalking.initialize(settings.AFRICASTALKING_USERNAME, settings.AFRICASTALKING_API_KEY)
    sms = africastalking.SMS
    sms.send(message, [phone])


def verify_otp(phone, code):
    otp = (
        OTPRequest.objects.filter(phone=phone, consumed=False)
        .order_by("-created_at")
        .first()
    )
    if not otp:
        return None, "No pending OTP for this number"
    if otp.expires_at < timezone.now():
        return None, "OTP expired"
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return None, "Too many attempts"

    otp.attempt_count += 1
    otp.save(update_fields=["attempt_count"])

    if otp.code_hash != _hash_code(code):
        return None, "Incorrect code"

    otp.consumed = True
    otp.save(update_fields=["consumed"])

    user, _created = User.objects.get_or_create(phone=phone)
    user.otp_verified = True
    user.save(update_fields=["otp_verified"])
    return user, None
