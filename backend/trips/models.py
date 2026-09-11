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

    def __str__(self):
        return f"{self.event_type} @ {self.created_at:%H:%M:%S} for {self.trip_id}"


class FareQuote(TimeStampedModel):
    trip = models.OneToOneField(Trip, on_delete=models.CASCADE, related_name="fare_quote")
    distance_km = models.DecimalField(max_digits=6, decimal_places=2)
    base_fare = models.DecimalField(max_digits=8, decimal_places=2)
    per_km_charge = models.DecimalField(max_digits=8, decimal_places=2)
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
