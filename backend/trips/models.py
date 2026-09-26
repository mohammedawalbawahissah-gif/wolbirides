from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Trip(TimeStampedModel):
    """
    PRD Section 5 & 6. `status` drives the whole matching/lifecycle state
    machine described in PRD Section 6.2 — keep transitions restricted to
    the service layer (trips/services.py), never edited ad hoc from views.
    """

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        MATCHING = "matching", "Matching"
        MATCHED = "matched", "Matched"
        DRIVER_ARRIVING = "driver_arriving", "Driver Arriving"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_DRIVERS_FOUND = "no_drivers_found", "No Drivers Found"

    passenger = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="trips_as_passenger"
    )
    driver = models.ForeignKey(
        "drivers.Driver", on_delete=models.SET_NULL, null=True, blank=True, related_name="trips_as_driver"
    )
    zone = models.ForeignKey("zones.ServiceZone", on_delete=models.PROTECT, related_name="trips")

    pickup_lat = models.DecimalField(max_digits=9, decimal_places=6)
    pickup_lng = models.DecimalField(max_digits=9, decimal_places=6)
    pickup_label = models.CharField(max_length=255, blank=True)
    destination_lat = models.DecimalField(max_digits=9, decimal_places=6)
    destination_lng = models.DecimalField(max_digits=9, decimal_places=6)
    destination_label = models.CharField(max_length=255, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REQUESTED)

    # WR-23: the same trip lifecycle carries parcels (WolbiDeliver).
    class Kind(models.TextChoices):
        RIDE = "ride", "Ride"
        DELIVERY = "delivery", "Delivery"

    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Cash"
        MOMO = "momo", "Mobile Money"
        ORGANIZATION = "organization", "Billed to organization"  # WR-21
        VOUCHER = "voucher", "Organization voucher"  # WR-21
        BUNDLE = "bundle", "Prepaid bundle"  # WR-22

    trip_type = models.CharField(max_length=10, choices=Kind.choices, default=Kind.RIDE)
    payment_method = models.CharField(max_length=15, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, null=True, blank=True, related_name="trips"
    )
    bundle = models.ForeignKey(
        "bundles.PassengerBundle", on_delete=models.PROTECT, null=True, blank=True, related_name="trips"
    )
    # WR-17: shared rides. Each rider keeps their own trip (own pickup,
    # drop-off, payment); a PoolGroup groups the trips one vehicle carries.
    shareable = models.BooleanField(default=False)
    pool_group = models.ForeignKey("trips.PoolGroup", on_delete=models.SET_NULL, null=True, blank=True, related_name="trips")
    pool_seat_fare = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    # WR-18: set once the rider sends a live share link.
    shared_with_contact = models.BooleanField(default=False)
    # WR-19: when a hard preference can't be met, the rider decides; never silently reassigned.
    class PreferenceStatus(models.TextChoices):
        NONE = "", "None"
        AWAITING_RIDER = "awaiting_rider", "Waiting for rider's decision"
        KEEP_WAITING = "keep_waiting", "Rider chose to keep waiting"
        RELAXED = "relaxed", "Rider accepted any driver"

    preference_status = models.CharField(max_length=15, choices=PreferenceStatus.choices, blank=True, default="")
    # WR-21 voucher paying for this trip.
    voucher = models.ForeignKey(
        "organizations.RideVoucher", on_delete=models.PROTECT, null=True, blank=True, related_name="trips"
    )
    # WR-19: snapshot of what the passenger asked for on this trip.
    preferences = models.JSONField(default=dict, blank=True)

    fare_final = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    cancel_reason = models.CharField(max_length=255, blank=True)
    cancelled_by = models.CharField(
        max_length=20, choices=[("passenger", "Passenger"), ("driver", "Driver"), ("system", "System")], blank=True
    )

    requested_at = models.DateTimeField(auto_now_add=True)
    matched_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "zone"]),
            models.Index(fields=["passenger", "status"]),
            models.Index(fields=["driver", "status"]),
            models.Index(fields=["status", "completed_at"]),  # payouts, invoices, fairness, reports
        ]

    def __str__(self):
        return f"Trip<{self.id}> {self.status}"


class TripEvent(TimeStampedModel):
    """
    Append-only audit trail of every state transition on a Trip.
    Per PRD Section 8: this is the source of truth for dispute resolution
    and incident review — never mutated or deleted.
    """

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=50)
    payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["created_at"]
        # Admin fairness/trust reports filter events by type over a date range.
        indexes = [models.Index(fields=["event_type", "created_at"])]

    def __str__(self):
        return f"{self.event_type} @ {self.created_at:%H:%M:%S} for {self.trip_id}"


class FareQuote(TimeStampedModel):
    trip = models.OneToOneField(Trip, on_delete=models.CASCADE, related_name="fare_quote")
    distance_km = models.DecimalField(max_digits=6, decimal_places=2)
    base_fare = models.DecimalField(max_digits=8, decimal_places=2)
    per_km_charge = models.DecimalField(max_digits=8, decimal_places=2)
    surcharge = models.DecimalField(max_digits=8, decimal_places=2, default=0)  # WR-23 delivery surcharge
    discount = models.DecimalField(max_digits=8, decimal_places=2, default=0)  # WR-24 promo discount
    discount_reason = models.CharField(max_length=120, blank=True)
    total = models.DecimalField(max_digits=8, decimal_places=2)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Quote<{self.total}> for {self.trip_id}"


class Rating(TimeStampedModel):
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="ratings")
    rater = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_given"
    )
    rated = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings_received"
    )
    score = models.PositiveSmallIntegerField()
    issue_tags = models.JSONField(default=list, blank=True)
    comment = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["trip", "rater"], name="one_rating_per_rater_per_trip")
        ]

    def __str__(self):
        return f"{self.score}★ on {self.trip_id}"


class TripPreference(TimeStampedModel):
    """WR-19: a passenger's default preferences, copied onto each trip (overridable per trip).

    Only the matching engine reads these. Drivers are never told a rider's
    preferences or why they were or weren't offered a trip.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trip_preference")
    preferred_driver_gender = models.CharField(
        max_length=10, blank=True, default="", choices=[("", "No preference"), ("female", "Female"), ("male", "Male")]
    )
    prefer_previous_drivers = models.BooleanField(default=False)
    quiet_ride = models.BooleanField(default=False)
    needs_luggage_space = models.BooleanField(default=False)
    needs_accessibility_help = models.BooleanField(default=False)

    def as_dict(self):
        return {
            "preferred_driver_gender": self.preferred_driver_gender,
            "prefer_previous_drivers": self.prefer_previous_drivers,
            "quiet_ride": self.quiet_ride,
            "needs_luggage_space": self.needs_luggage_space,
            "needs_accessibility_help": self.needs_accessibility_help,
        }


class DeliveryDetail(TimeStampedModel):
    """WR-23: what makes a trip a delivery. One per delivery trip."""

    class PackageSize(models.TextChoices):
        SMALL = "small", "Small (fits in a bag)"
        MEDIUM = "medium", "Medium (a box on the lap)"
        LARGE = "large", "Large (needs the rear space)"

    trip = models.OneToOneField(Trip, on_delete=models.CASCADE, related_name="delivery")
    recipient_name = models.CharField(max_length=150)
    recipient_phone = models.CharField(max_length=20)
    package_description = models.CharField(max_length=255)
    package_size = models.CharField(max_length=10, choices=PackageSize.choices, default=PackageSize.SMALL)
    pickup_code = models.CharField(max_length=6)  # sender shows this to the driver at pickup
    dropoff_code = models.CharField(max_length=6)  # texted to the recipient; driver needs it to finish
    pickup_confirmation_photo = models.URLField(blank=True)
    dropoff_confirmation_photo = models.URLField(blank=True)
    picked_up_at = models.DateTimeField(null=True, blank=True)


class PoolGroup(TimeStampedModel):
    """WR-17: up to POOL_MAX_RIDERS trips sharing one vehicle leg. Open to new riders until the first pickup."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    driver = models.ForeignKey("drivers.Driver", on_delete=models.CASCADE, related_name="pools", null=True, blank=True)
    matched_at = models.DateTimeField(null=True, blank=True)
    zone = models.ForeignKey("zones.ServiceZone", on_delete=models.CASCADE, related_name="pools")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
