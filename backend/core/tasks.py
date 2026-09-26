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
