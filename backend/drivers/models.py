from django.conf import settings
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
    licence_number = models.CharField(max_length=50)
    licence_expiry = models.DateField(null=True, blank=True)
    licence_document = models.URLField(blank=True, help_text="Cloudinary URL")
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
    registration_document = models.URLField(blank=True, help_text="Cloudinary URL")
    photo = models.URLField(blank=True, help_text="Cloudinary URL")
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.plate_number} ({self.driver})"
