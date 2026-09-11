from django.db import models

from core.models import TimeStampedModel


class ServiceZone(TimeStampedModel):
    """
    PRD Section 5. Kept deliberately simple for MVP: a bounding box rather
    than a full polygon service, since WR-02.8 says the launch zone is a
    single high-density UDS area, not multi-zone from day one. `boundary`
    stores GeoJSON so this can grow into a real polygon check later without
    a schema change.
    """

    name = models.CharField(max_length=100, unique=True)
    boundary = models.JSONField(
        help_text="GeoJSON polygon or simple bounding-box dict {min_lat, max_lat, min_lng, max_lng}"
    )
    base_fare = models.DecimalField(max_digits=8, decimal_places=2)
    per_km_rate = models.DecimalField(max_digits=8, decimal_places=2)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class PickupPoint(TimeStampedModel):
    zone = models.ForeignKey(ServiceZone, on_delete=models.CASCADE, related_name="pickup_points")
    name = models.CharField(max_length=150)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    is_campus_point = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name} ({self.zone.name})"
