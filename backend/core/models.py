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
        DRIVER = "driver", "Rider"
        INCIDENT = "incident", "Incident"
        SUPPORT = "support", "Support"
        SYSTEM = "system", "System"
        PAYOUT = "payout", "Payout"
        RECURRING_REMINDER = "recurring_reminder", "Recurring ride reminder"

    # WR-16: functional categories are never user-disable-able (trip status,
    # payouts, safety, incidents) — only categories that exist purely for
    # convenience can be turned off. Named here rather than inferred, so
    # adding a new category forces a deliberate choice about which bucket
    # it belongs in instead of silently defaulting to one behavior.
    OPTIONAL_CATEGORIES = {Category.RECURRING_REMINDER}

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.SYSTEM)
    title = models.CharField(max_length=150)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=255, blank=True)  # frontend route, e.g. /trip/<id>
    read = models.BooleanField(default=False)
    # Set once the email / SMS copy has actually gone out, so a retry never sends it twice.
    email_sent_at = models.DateTimeField(null=True, blank=True)
    sms_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read"])]

    def __str__(self):
        return f"{self.title} -> {self.user_id}"


class NotificationPreference(TimeStampedModel):
    """
    WR-16: opt-out for optional notification categories only. Absence of a
    row means "enabled" (the default) — a row only ever gets created when
    someone actually turns something off, so most users never have any
    rows here at all.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preferences")
    category = models.CharField(max_length=20, choices=Notification.Category.choices)
    enabled = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "category"], name="one_preference_per_user_category")]


def is_notification_enabled(user, category):
    """Functional categories are always on — the passenger can turn off a
    'nice to have' reminder but never a trip-status or payout alert."""
    if category not in Notification.OPTIONAL_CATEGORIES:
        return True
    pref = NotificationPreference.objects.filter(user=user, category=category).first()
    return pref.enabled if pref else True


def notify(user, title, body="", category=Notification.Category.SYSTEM, link="", channels=None):
    """
    Small helper so other apps don't need to know the model's field names.
    Silently no-ops for optional categories the user has turned off (see
    is_notification_enabled) — functional categories always go through.

    Besides the bell and phone push, a notification can also go out by email and/or SMS: pass
    channels=("sms",) / ("email",) / ("email", "sms") to choose, or leave it None to use the
    category default (core/channels.py).
    """
    if not is_notification_enabled(user, category):
        return None
    notification = Notification.objects.create(user=user, title=title, body=body, category=category, link=link)
    # WR-16: passengers aren't staring at the app, so functional alerts also go out as
    # phone push notifications when the user has registered a device.
    from django.db import transaction

    transaction.on_commit(lambda: _queue_push(notification.id))
    from core.channels import channels_for

    wanted = channels_for(category, channels)
    if wanted:
        transaction.on_commit(lambda: _queue_delivery(notification.id, wanted))
    return notification


def _queue_delivery(notification_id, wanted):
    """Best-effort, like push: a broker hiccup must never break whatever triggered the notification."""
    try:
        from core.tasks import deliver_channels

        deliver_channels.delay(str(notification_id), list(wanted))
    except Exception:
        import logging

        logging.getLogger(__name__).warning("Couldn't queue email/SMS for notification %s", notification_id)


def _queue_push(notification_id):
    """Best-effort: the in-app notification already exists, so a broker hiccup must never
    break whatever triggered the notification."""
    if not DeviceToken.objects.filter(user__notifications__id=notification_id).exists():
        return
    try:
        from core.tasks import send_push

        send_push.delay(str(notification_id))
    except Exception:
        import logging

        logging.getLogger(__name__).warning("Couldn't queue push for notification %s", notification_id)


class DeviceToken(TimeStampedModel):
    """WR-16: an Expo push token for one of the user's phones."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="device_tokens")
    token = models.CharField(max_length=200, unique=True)
    platform = models.CharField(max_length=10, blank=True)
    app = models.CharField(max_length=20, blank=True)  # passenger | driver
