"""Which notifications also go out by email and SMS (the bell and phone push always happen).

Email is cheap, so most account-level notices go by email. SMS costs money per message, so it is kept for the
moments where someone is likely away from the app and acting late has a real cost: a rider is on the way or
close by, a trip was cancelled, a safety check, a payout, a verification result, SOS to staff.

`notify(..., channels=("sms",))` overrides the category default for one call. Nothing is sent to a user who has
no email (or no real phone number), and delivery runs in a background task so it never slows or breaks the
action that triggered it.
"""
from django.conf import settings

EMAIL = "email"
SMS = "sms"
ALL = (EMAIL, SMS)

# What a notification does when the caller doesn't say. Trip pings stay bell + push only.
CATEGORY_DEFAULTS = {
    "trip": (),
    "driver": (EMAIL,),
    "incident": (),
    "support": (EMAIL,),
    "system": (EMAIL,),
    "payout": (EMAIL, SMS),
    "recurring_reminder": (),
}

SMS_MAX = 160


def channels_for(category, explicit=None):
    """The channels to deliver on, as a tuple ('email', 'sms'); empty when delivery is switched off."""
    if not getattr(settings, "NOTIFY_CHANNELS_ENABLED", True):
        return ()
    key = getattr(category, "value", category)
    chosen = CATEGORY_DEFAULTS.get(key, ()) if explicit is None else explicit
    return tuple(c for c in ALL if c in chosen)


def _app_link(user, link):
    """Only passengers have a link we can build here: a rider's or admin's address isn't known to this server."""
    if link and link.startswith("/") and getattr(user, "role", "") == "passenger":
        base = (getattr(settings, "PASSENGER_WEB_URL", "") or "").rstrip("/")
        if base.startswith("https://"):
            return f"{base}{link}"
    return ""


def sms_text(notification):
    body = f"WolbiRides: {notification.title}"
    if notification.body:
        body += f". {notification.body}"
    return body if len(body) <= SMS_MAX else body[: SMS_MAX - 1].rstrip() + "…"


def email_parts(notification):
    """(subject, plain-text body)."""
    lines = [notification.title]
    if notification.body:
        lines += ["", notification.body]
    url = _app_link(notification.user, notification.link)
    if url:
        lines += ["", f"Open in WolbiRides: {url}"]
    lines += ["", "You are getting this because you have a WolbiRides account."]
    return f"WolbiRides: {notification.title}", "\n".join(lines)
