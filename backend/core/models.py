import uuid

from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    """Abstract base: every table gets a UUID pk + created/updated timestamps."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AuditLog(TimeStampedModel):
    """
    Immutable record of sensitive admin/system actions.
    Per WR-05.5 (non-functional requirements) and PRD Section 8:
    every Trip/Payment/Incident-affecting write should be traceable.
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=100)
    target_model = models.CharField(max_length=100)
    target_id = models.CharField(max_length=64)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_model", "target_id"]),
            models.Index(fields=["actor", "created_at"]),
        ]

    def __str__(self):
        return f"{self.action} on {self.target_model}:{self.target_id} by {self.actor_id}"


class Notification(TimeStampedModel):
    """
    In-app notification bell content — deliberately generic (one table,
    every role) rather than per-app tables, since the same shape (title,
    body, optional deep link, read flag) covers driver-verification
    outcomes, trip status pings, incident/support updates, and anything
    else that comes up later.
    """

    class Category(models.TextChoices):
        TRIP = "trip", "Trip"
        DRIVER = "driver", "Driver"
        INCIDENT = "incident", "Incident"
        SUPPORT = "support", "Support"
        SYSTEM = "system", "System"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.SYSTEM)
    title = models.CharField(max_length=150)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=255, blank=True)  # frontend route, e.g. /trip/<id>
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read"])]

    def __str__(self):
        return f"{self.title} -> {self.user_id}"


def notify(user, title, body="", category=Notification.Category.SYSTEM, link=""):
    """Small helper so other apps don't need to know the model's field names."""
    return Notification.objects.create(user=user, title=title, body=body, category=category, link=link)
