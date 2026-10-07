import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.models import TimeStampedModel


class Driver(TimeStampedModel):
    """
    PRD Section 5. `current_lat`/`current_lng`/`last_ping_at` are a
    denormalized snapshot for admin/reporting convenience — the live,
    high-frequency location feed lives in Redis (see trips.matching),
    not written here on every websocket ping, to avoid write-amplifying
    Postgres (PRD Section 6.1 / Section 8).
    """

    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending review"
        VERIFIED = "verified", "Verified"
        SUSPENDED = "suspended", "Suspended"
        REJECTED = "rejected", "Rejected"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="driver_profile")
    licence_number = models.CharField(max_length=50, help_text="DVLA commercial rider's licence number")
    licence_expiry = models.DateField(null=True, blank=True)
    licence_document = models.URLField(blank=True, help_text="File URL")
    # Road Traffic Regulations 2026 (LI 2519): a commercial rider needs a valid Ghana Card and
    # proof of membership of a commercial transport organization for motorcycles/tricycles.
    # Ghana Card number is personal data: shown only to the rider themself and to admins.
    ghana_card_number = models.CharField(max_length=20, blank=True, default="",
                                         help_text="Format GHA-123456789-0")
    ghana_card_document = models.URLField(blank=True, help_text="File URL")
    transport_union = models.CharField(max_length=120, blank=True, default="",
                                       help_text="e.g. National Union of Tricycle Operators, Tamale branch")
    union_membership_number = models.CharField(max_length=50, blank=True, default="")
    union_card_document = models.URLField(blank=True, help_text="File URL")
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    quality_score = models.DecimalField(max_digits=4, decimal_places=2, default=5.00)

    is_online = models.BooleanField(default=False)
    current_zone = models.ForeignKey(
        "zones.ServiceZone", on_delete=models.SET_NULL, null=True, blank=True, related_name="drivers"
    )
    current_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    current_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    last_ping_at = models.DateTimeField(null=True, blank=True)

    # WR-19 / WR-23: what this driver offers, matched against passenger preferences.
    offers_quiet_ride = models.BooleanField(default=False)
    has_luggage_space = models.BooleanField(default=False)
    accessibility_trained = models.BooleanField(default=False)
    accepts_deliveries = models.BooleanField(default=False)
    # WR-19: optional, self-reported, used only by matching. Never shown anywhere else.
    gender = models.CharField(max_length=10, blank=True, default="",
                              choices=[("", "Not stated"), ("female", "Female"), ("male", "Male")])

    emergency_contact_name = models.CharField(max_length=150, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)

    # A rider's account phone doubles as their login and their contact number by default. Some
    # riders register their mobile money wallet on a different SIM than the one they use day to
    # day, so payouts need their own destination, chosen separately — never assumed from login.
    class PayoutProvider(models.TextChoices):
        MOMO = "momo", "MTN MoMo"
        HUBTEL = "hubtel", "Hubtel"

    payout_phone = models.CharField(max_length=20, blank=True,
                                    help_text="Where payouts are sent. Blank falls back to the account phone.")
    payout_provider = models.CharField(max_length=10, choices=PayoutProvider.choices, default=PayoutProvider.MOMO)

    class Meta:
        indexes = [
            models.Index(fields=["verification_status", "is_online"]),
            models.Index(fields=["current_zone", "is_online"]),
        ]

    @property
    def is_dispatchable(self):
        """A driver only receives ride requests if verified, online, and in an active zone."""
        return (
            self.verification_status == self.VerificationStatus.VERIFIED
            and self.is_online
            and self.current_zone_id is not None
        )

    def compliance_missing(self):
        """What a rider still has to provide before ops can verify them. Empty = complete.
        Checked by the admin verify action. Union membership and the roadworthy certificate are
        optional (collected when the rider has them), so they never block verification."""
        missing = []
        if not self.licence_number:
            missing.append("licence_number")
        if not self.ghana_card_number:
            missing.append("ghana_card_number")
        if not any(v.active for v in self.vehicles.all()):  # uses prefetch when present
            missing.append("vehicle")
        return missing

    def payout_destination(self):
        """(phone, provider) money actually goes to — payout_phone if the rider set one, else
        their account phone. Never blank: the account phone is always a real number."""
        return (self.payout_phone or self.user.real_phone, self.payout_provider)

    def __str__(self):
        return f"Rider<{self.user.phone}>"


class Vehicle(TimeStampedModel):
    class VehicleType(models.TextChoices):
        YELLOW_YELLOW = "yellow_yellow", "Yellow-Yellow / Tricycle"

    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="vehicles")
    plate_number = models.CharField(max_length=20, unique=True)
    vehicle_type = models.CharField(max_length=30, choices=VehicleType.choices, default=VehicleType.YELLOW_YELLOW)
    registration_document = models.URLField(blank=True, help_text="File URL")
    photo = models.URLField(blank=True, help_text="File URL")
    # LI 2519: a commercial tricycle must be DVLA-registered for commercial use and roadworthy.
    roadworthy_certificate = models.URLField(blank=True, help_text="File URL")
    roadworthy_expiry = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.plate_number} ({self.driver})"


def normalize_ghana_card(value):
    """'gha 123456789 0' / 'GHA1234567890' -> 'GHA-123456789-0'. Raises ValidationError if it
    can't be read as a Ghana Card PIN."""
    digits = re.sub(r"[^0-9]", "", value or "")
    prefix = re.sub(r"[^A-Za-z]", "", value or "").upper()
    if prefix != "GHA" or len(digits) != 10:
        raise ValidationError("Enter the Ghana Card number as GHA-123456789-0.")
    return f"GHA-{digits[:9]}-{digits[9]}"


class RiderPassPlan(TimeStampedModel):
    """
    A paid pass a rider buys to go online (instead of a per-trip commission). Plans and prices are
    set by ops in admin; the first price is meant to be tested with riders and changed.
    Enforced only when settings.RIDER_PASS_REQUIRED is on.
    """

    name = models.CharField(max_length=60)
    duration_days = models.PositiveSmallIntegerField()
    price = models.DecimalField(max_digits=8, decimal_places=2)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["duration_days", "price"]

    def clean(self):
        if self.duration_days == 0:
            raise ValidationError("A pass lasts at least 1 day.")
        if self.price is not None and self.price <= 0:
            raise ValidationError("Price must be above zero.")

    def __str__(self):
        return f"{self.name} ({self.duration_days}d, GH₵{self.price})"


class RiderPass(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING_PAYMENT = "pending_payment", "Awaiting payment"
        ACTIVE = "active", "Active"  # paid; may be queued to start after the current pass
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"

    class Source(models.TextChoices):
        TRIAL = "trial", "Free trial"
        MOMO = "momo", "Mobile Money"
        CASH = "cash", "Paid to ops (cash)"
        GRANT = "grant", "Granted by ops"

    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="passes")
    plan = models.ForeignKey(RiderPassPlan, on_delete=models.PROTECT, null=True, blank=True, related_name="sales")
    source = models.CharField(max_length=10, choices=Source.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_PAYMENT)
    # Snapshotted so a later plan edit never changes what a rider already bought.
    duration_days = models.PositiveSmallIntegerField()
    price_paid = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    payment_reference = models.CharField(max_length=100, blank=True)
    payer_phone = models.CharField(max_length=20, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+", help_text="Admin who recorded a cash payment or grant")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["driver", "status", "expires_at"])]

    def __str__(self):
        return f"RiderPass<{self.source} {self.status}> {self.driver_id}"
