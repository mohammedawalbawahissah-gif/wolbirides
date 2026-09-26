"""
WR-18 safety features beyond the SOS button (SOS itself lives in
incidents/, since an SOS *is* a P0 incident):

- TripShare: a revocable, unguessable link a passenger can send to someone
  so they can follow the ride live without an account.
- SafetyCheckIn: an automatic "Are you OK?" prompt when an in-progress
  trip runs much longer than expected; unanswered prompts escalate to ops.
"""
import secrets

from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


def _new_share_token():
    return secrets.token_urlsafe(24)


class TripShare(TimeStampedModel):
    trip = models.ForeignKey("trips.Trip", on_delete=models.CASCADE, related_name="shares")
    token = models.CharField(max_length=64, unique=True, default=_new_share_token, db_index=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    revoked_at = models.DateTimeField(null=True, blank=True)
    sent_to_phone = models.CharField(max_length=20, blank=True)

    def __str__(self):
        return f"share {self.trip_id}"


class SafetyCheckIn(TimeStampedModel):
    class Response(models.TextChoices):
        OK = "ok", "I'm OK"
        HELP = "help", "I need help"

    trip = models.ForeignKey("trips.Trip", on_delete=models.CASCADE, related_name="check_ins")
    reason = models.CharField(max_length=100, default="trip_overdue")
    responded_at = models.DateTimeField(null=True, blank=True)
    response = models.CharField(max_length=10, choices=Response.choices, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_pending(self):
        return self.responded_at is None and self.escalated_at is None
