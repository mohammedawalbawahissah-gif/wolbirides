from celery import shared_task


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def send_push(self, notification_id):
    """WR-16: deliver a notification to the user's phones through Expo's push service."""
    import logging

    import requests

    from core.models import DeviceToken, Notification

    n = Notification.objects.filter(id=notification_id).select_related("user").first()
    if not n:
        return 0
    tokens = list(DeviceToken.objects.filter(user=n.user).values_list("token", flat=True))
    if not tokens:
        return 0
    messages = [{"to": t, "title": n.title, "body": n.body, "sound": "default",
                 "priority": "high" if n.category in ("trip", "incident") else "default",
                 "data": {"link": n.link, "category": n.category}} for t in tokens]
    try:
        resp = requests.post("https://exp.host/--/api/v2/push/send", json=messages, timeout=10)
        # Tokens Expo says are dead get removed so we stop sending to them.
        # Expo can return fewer receipts than tokens, so pairs stop at the shorter list on purpose.
        for token, ticket in zip(tokens, (resp.json().get("data") or []), strict=False):
            if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                DeviceToken.objects.filter(token=token).delete()
    except Exception as exc:
        logging.getLogger(__name__).warning("Push send failed for %s: %s", notification_id, exc)
        raise self.retry(exc=exc) from exc
    return len(tokens)


@shared_task
def flush_expired_tokens():
    """Daily: rotation records every issued refresh token; drop the expired ones."""
    from django.core.management import call_command

    call_command("flushexpiredtokens")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def deliver_channels(self, notification_id, channels):
    """Send the email and/or SMS copy of a notification. Safe to retry: each channel is stamped once it has
    gone out, so a retry only repeats the one that failed."""
    import logging

    from django.utils import timezone

    from accounts.services import _send_email, _send_sms
    from core.channels import EMAIL, SMS, email_parts, sms_text
    from core.models import Notification

    log = logging.getLogger(__name__)
    n = Notification.objects.select_related("user").filter(id=notification_id).first()
    if not n or not n.user.is_active:
        return {}
    sent, failed = {}, []

    if EMAIL in channels and not n.email_sent_at and n.user.email:
        try:
            subject, body = email_parts(n)
            _send_email(n.user.email, subject, body)
            n.email_sent_at = timezone.now()
            n.save(update_fields=["email_sent_at"])
            sent[EMAIL] = True
        except Exception as exc:
            log.warning("Email for notification %s failed: %s", notification_id, exc)
            failed.append(EMAIL)

    phone = n.user.real_phone
    if SMS in channels and not n.sms_sent_at and phone:
        try:
            _send_sms(phone, sms_text(n))
            n.sms_sent_at = timezone.now()
            n.save(update_fields=["sms_sent_at"])
            sent[SMS] = True
        except Exception as exc:
            log.warning("SMS for notification %s failed: %s", notification_id, exc)
            failed.append(SMS)

    if failed:
        raise self.retry(exc=RuntimeError("delivery failed: " + ", ".join(failed)))
    return sent
