import hashlib
import random

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from accounts.models import EmailOTPRequest, OTPRequest, User

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


# --- Email + password signup/login (WR UX overhaul) --------------------

def request_email_otp(email):
    code = f"{random.randint(0, 999999):06d}"
    EmailOTPRequest.objects.create(
        email=email,
        code_hash=_hash_code(code),
        expires_at=timezone.now() + timezone.timedelta(minutes=OTP_TTL_MINUTES),
    )
    _send_email(
        email,
        "Your WolbiRides verification code",
        f"Your verification code is {code}. It expires in {OTP_TTL_MINUTES} minutes.",
    )


def _send_email(to_email, subject, message):
    """
    Same dev-fallback shape as _send_sms: with no real SMTP configured,
    Django's console backend prints the email to the runserver log instead
    of failing, so signup still works end-to-end in local development.
    """
    send_mail(
        subject,
        message,
        settings.DEFAULT_FROM_EMAIL,
        [to_email],
        fail_silently=False,
    )


def verify_email_otp(email, code):
    """Checks the code without consuming it — signup consumes it separately
    once the rest of the form (password, name) also validates."""
    otp = EmailOTPRequest.objects.filter(email=email, consumed=False).order_by("-created_at").first()
    if not otp:
        return None, "No pending code for this email"
    if otp.expires_at < timezone.now():
        return None, "Code expired"
    if otp.attempt_count >= OTP_MAX_ATTEMPTS:
        return None, "Too many attempts"
    otp.attempt_count += 1
    otp.save(update_fields=["attempt_count"])
    if otp.code_hash != _hash_code(code):
        return None, "Incorrect code"
    return otp, None


def signup_with_email(email, code, password, name, role="passenger"):
    if User.objects.filter(email__iexact=email).exists():
        return None, "An account with this email already exists"

    otp, error = verify_email_otp(email, code)
    if error:
        return None, error

    otp.consumed = True
    otp.save(update_fields=["consumed"])

    user = User.objects.create_user_with_email(email=email, password=password, name=name, role=role)
    user.otp_verified = True
    user.save(update_fields=["otp_verified"])
    return user, None


def login_with_email(email, password):
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return None, "Incorrect email or password"
    if not user.has_usable_password() or not user.check_password(password):
        return None, "Incorrect email or password"
    if not user.is_active:
        return None, "This account has been deactivated"
    return user, None
