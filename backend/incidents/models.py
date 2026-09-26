from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Incident(TimeStampedModel):
    """
    PRD Section 5, severity levels from blueprint WR-06.3.
    P0/P1 incidents should trigger immediate escalation in the service
    layer (e.g. auto-suspend the driver pending review) — that logic
    belongs in incidents/services.py, not here.
    """

    class Severity(models.TextChoices):
        P0_CRITICAL = "p0", "P0 – Critical"
        P1_SERIOUS = "p1", "P1 – Serious"
        P2_SERVICE = "p2", "P2 – Service"
        P3_FEEDBACK = "p3", "P3 – Feedback"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        INVESTIGATING = "investigating", "Investigating"
        RESOLVED = "resolved", "Resolved"

    trip = models.ForeignKey(
        "trips.Trip", on_delete=models.SET_NULL, null=True, blank=True, related_name="incidents"
    )
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="incidents_reported"
    )
    severity = models.CharField(max_length=5, choices=Severity.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    description = models.TextField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    # WR-18: SOS alerts are P0 incidents raised from the in-trip SOS button,
    # carrying the reporter's last known position for ops.
    class TriggerSource(models.TextChoices):
        SOS_BUTTON = "sos_button", "SOS button"
        POST_TRIP_CHECKIN = "post_trip_checkin", "Post-trip check-in"
        OVERDUE_CHECKIN = "overdue_checkin", "Unanswered in-trip check-in"
        MANUAL_REPORT = "manual_report", "Manual report"

    trigger_source = models.CharField(max_length=20, choices=TriggerSource.choices, default=TriggerSource.MANUAL_REPORT)
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["severity", "status"])]

    def __str__(self):
        return f"[{self.severity}] {self.status} — {self.description[:40]}"
