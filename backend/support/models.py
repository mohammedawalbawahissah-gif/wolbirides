from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class SupportTicket(TimeStampedModel):
    class Category(models.TextChoices):
        TRIP_ISSUE = "trip_issue", "Trip Issue"
        PAYMENT = "payment", "Payment"
        ACCOUNT = "account", "Account"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED = "resolved", "Resolved"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="support_tickets")
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    subject = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tickets",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"[{self.status}] {self.subject}"
