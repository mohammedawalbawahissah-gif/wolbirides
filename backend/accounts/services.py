import hashlib
import secrets
import re

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from accounts.models import EmailOTPRequest, User

OTP_TTL_MINUTES = 5
OTP_MAX_ATTEMPTS = 5


def normalize_phone(raw):
    """
    Canonicalizes a phone number so the same physical number always maps
    to the same User row, regardless of how someone typed it. Without
    this, "0509231963" and "+233509231963" — the same Ghanaian number in
    local vs. international format — silently create two separate
    accounts, which is exactly what happened in production data before
    this fix (confirmed via direct DB inspection: two live User rows for
    what all evidence points to being one person).

    Ghana-first since that's the pilot market (WR-01), with a safe
    passthrough for numbers that already look properly international —
    this deliberately does not try to guess a country code for formats it
    doesn't recognize, since a wrong guess is worse than leaving it alone.
    """
    if not raw:
        return raw
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if digits.startswith("+"):
        return digits
    if digits.startswith("00"):
        return "+" + digits[2:]
    if digits.startswith("0") and len(digits) == 10:
        # Ghanaian local format (0XXXXXXXXX) -> +233XXXXXXXXX
        return "+233" + digits[1:]
    if digits.startswith("233"):
        return "+" + digits
    return digits


def _new_code():
    """Security codes come from the OS's secure random source, never `random`."""
    return f"{secrets.randbelow(1_000_000):06d}"


def _hash_code(code):
    return hashlib.sha256(code.encode()).hexdigest()


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


def request_email_otp(email, purpose=EmailOTPRequest.Purpose.SIGNUP):
    code = _new_code()
    EmailOTPRequest.objects.create(
        email=email,
        purpose=purpose,
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


def verify_email_otp(email, code, purpose=EmailOTPRequest.Purpose.SIGNUP):
    """Checks the code without consuming it — signup consumes it separately
    once the rest of the form (password, name) also validates."""
    otp = EmailOTPRequest.objects.filter(email__iexact=email, purpose=purpose, consumed=False).order_by("-created_at").first()
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


def mark_saved_address_used(user, address_id):
    """
    WR-13: called from the trip-request flow when the passenger picked a
    saved place rather than dropping a fresh pin. Silently no-ops on a
    missing/foreign address id rather than raising — this is a "nice to
    have" usage counter, not something that should ever block a ride
    request from going through.
    """
    from django.db.models import F
    from django.utils import timezone

    from accounts.models import SavedAddress

    SavedAddress.objects.filter(id=address_id, user=user).update(
        usage_count=F("usage_count") + 1, last_used_at=timezone.now()
    )


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


def get_suggested_ride(user, days=30, min_trips=2):
    """
    WR-13: finds the passenger's most-repeated pickup/destination pair
    over the trailing window, for the "Book my usual" quick action.
    Coordinates are rounded to 3 decimal places (~110m at the equator)
    before grouping, so two requests from "outside the same building"
    still count as the same place — exact-float matching would almost
    never fire twice given normal GPS jitter.

    Import of trips.models is local to avoid a hard cross-app import at
    module load time (accounts loads before trips in INSTALLED_APPS).
    """
    from collections import Counter

    from django.utils import timezone

    from trips.models import Trip

    since = timezone.now() - timezone.timedelta(days=days)
    trips = Trip.objects.filter(
        passenger=user,
        status=Trip.Status.COMPLETED,
        requested_at__gte=since,
    ).values("pickup_lat", "pickup_lng", "pickup_label", "destination_lat", "destination_lng", "destination_label")

    if not trips:
        return None

    def key(t):
        return (
            round(float(t["pickup_lat"]), 3), round(float(t["pickup_lng"]), 3),
            round(float(t["destination_lat"]), 3), round(float(t["destination_lng"]), 3),
        )

    counts = Counter(key(t) for t in trips)
    top_key, top_count = counts.most_common(1)[0]
    if top_count < min_trips:
        return None

    # Grab a representative trip matching the winning key for its labels
    # and unrounded coordinates.
    for t in trips:
        if key(t) == top_key:
            return {
                "pickup_label": t["pickup_label"] or "Pickup",
                "pickup_lat": t["pickup_lat"],
                "pickup_lng": t["pickup_lng"],
                "destination_label": t["destination_label"] or "Destination",
                "destination_lat": t["destination_lat"],
                "destination_lng": t["destination_lng"],
                "trip_count": top_count,
            }
    return None


# --- Password reset --------------------------------------------------------

def request_password_reset(email):
    """
    Emails a 6-digit reset code if an active account uses this email.
    Deliberately silent when none does, so this can't be used to find out
    who has a WolbiRides account.
    """
    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if not user:
        return
    code = _new_code()
    EmailOTPRequest.objects.create(
        email=user.email, purpose=EmailOTPRequest.Purpose.PASSWORD_RESET, code_hash=_hash_code(code),
        expires_at=timezone.now() + timezone.timedelta(minutes=OTP_TTL_MINUTES),
    )
    _send_email(
        user.email,
        "Reset your WolbiRides password",
        f"Your password reset code is {code}. It expires in {OTP_TTL_MINUTES} minutes.\n\n"
        f"If you didn't ask to reset your password, you can ignore this email; your password hasn't changed.",
    )


def reset_password(email, code, new_password):
    """Checks the code, sets the new password, and signs the account out everywhere else."""
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError

    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if not user:
        return None, "That code is incorrect or has expired."
    otp, error = verify_email_otp(user.email, code, purpose=EmailOTPRequest.Purpose.PASSWORD_RESET)
    if error:
        return None, error if error == "Too many attempts" else "That code is incorrect or has expired."
    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        return None, " ".join(exc.messages)

    otp.consumed = True
    otp.save(update_fields=["consumed"])
    user.set_password(new_password)
    user.save(update_fields=["password"])
    revoke_all_sessions(user)
    _send_email(user.email, "Your WolbiRides password was changed",
                "Your password was just changed and you've been signed out on your other devices. "
                "If this wasn't you, contact WolbiRides support right away.")
    return user, None


def revoke_all_sessions(user):
    """Blacklists every refresh token issued to this user (other phones and browsers
    are signed out within the access-token lifetime, at most an hour)."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)
