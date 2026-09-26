import re

from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle


class _TargetFieldThrottle(SimpleRateThrottle):
    """
    Base class for throttles keyed on a field in the request body (phone or
    email) rather than the requesting user (there isn't one yet on these
    AllowAny endpoints) or purely by IP.

    Why keyed by target rather than just IP: DRF's built-in AnonRateThrottle
    only limits how many requests one IP can make — it does nothing to stop
    one attacker from spreading requests across many source IPs (trivial
    with any proxy pool) to keep hammering a single victim's phone/email
    with OTP codes. Keying by the target field closes that gap: no matter
    how many IPs someone uses, one phone number or email address can only
    receive a bounded number of codes per window. Both this and a plain
    per-IP throttle are applied together (see views) as complementary
    layers — target-keyed stops victim harassment, IP-keyed stops one
    attacker enumerating many targets quickly.

    parse_rate is overridden because DRF's own implementation only accepts
    a bare unit as the period ('min', 'hour', 'day' — it literally reads
    just period[0] and looks it up in {'s','m','h','d'}), so a rate like
    "3/10min" crashes with KeyError('1') the first time it's used — '1'
    being the first character of "10min". This version accepts an
    optional numeric multiplier in front of the unit so "3/10min" means
    what it looks like it means: 3 requests per 10 minutes.
    """

    field_name = None

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        num, period = rate.split("/")
        num_requests = int(num)
        match = re.match(r"^(\d*)([a-z]+)$", period.strip().lower())
        if not match:
            raise ValueError(f"Invalid throttle rate period: {period!r}")
        multiplier = int(match.group(1)) if match.group(1) else 1
        unit_seconds = {
            "s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1,
            "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60,
            "h": 3600, "hour": 3600, "hours": 3600,
            "d": 86400, "day": 86400, "days": 86400,
        }[match.group(2)]
        return (num_requests, multiplier * unit_seconds)

    def get_cache_key(self, request, view):
        value = request.data.get(self.field_name) if hasattr(request.data, "get") else None
        if not value:
            # No identifiable target in the payload — let serializer-level
            # validation reject the request instead of throttling on an
            # empty/missing key that would otherwise bucket every malformed
            # request together.
            return None
        ident = str(value).strip().lower()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class EmailOTPRequestThrottle(_TargetFieldThrottle):
    scope = "otp_request_email"
    field_name = "email"


class EmailLoginThrottle(_TargetFieldThrottle):
    scope = "login_email"
    field_name = "email"


class SignupThrottle(_TargetFieldThrottle):
    scope = "signup_email"
    field_name = "email"


class ActionRateThrottle(ScopedRateThrottle):
    """
    Per signed-in user, per action (`throttle_scope` on the view, rates in settings).
    Reads (GET/HEAD/OPTIONS) are never limited: this is for actions that send SMS,
    cost money, or could be used to guess codes.
    """

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)
