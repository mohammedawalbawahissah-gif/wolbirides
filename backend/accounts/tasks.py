from celery import shared_task
from django.utils import timezone


@shared_task
def send_recurring_ride_reminders():
    """
    WR-13. Runs every few minutes (see CELERY_BEAT_SCHEDULE). Sends a
    reminder notification ~15 minutes before a passenger's usual ride
    time on a matching day of week — deliberately a reminder, not an
    auto-booked trip, so the passenger keeps a real confirmation step
    over a real cost (see the Growth PRD's guardrail on this).

    Idempotent per (schedule, day): last_reminded_at is checked against
    today's date, not the exact timestamp, so re-running this task within
    the same day never double-sends even if beat's interval overlaps the
    reminder window.
    """
    from accounts.models import RecurringRideSchedule
    from core.models import Notification, notify

    now = timezone.localtime()
    # A small grace period behind "now" absorbs beat-interval jitter (this
    # task runs every 5 minutes, so a reminder time that fell a couple of
    # minutes into the past relative to the last tick shouldn't be missed
    # entirely) — 15 minutes ahead is the actual "coming up" window.
    window_start = now - timezone.timedelta(minutes=2)
    window_end = now + timezone.timedelta(minutes=15)
    today_weekday = now.weekday()

    schedules = RecurringRideSchedule.objects.filter(active=True).select_related("pickup", "destination", "passenger")
    sent = 0
    for schedule in schedules:
        if today_weekday not in schedule.days_of_week:
            continue
        if schedule.last_reminded_at and timezone.localtime(schedule.last_reminded_at).date() == now.date():
            continue

        scheduled_dt = now.replace(
            hour=schedule.time_of_day.hour, minute=schedule.time_of_day.minute, second=0, microsecond=0
        )
        if not (window_start <= scheduled_dt <= window_end):
            continue

        # WR-16: don't remind someone about a ride they've already
        # requested today — a reminder that ignores what the person
        # already did is exactly the kind of "notification that stopped
        # being useful" this feature is supposed to avoid.
        from trips.models import Trip

        already_requested_today = Trip.objects.filter(
            passenger=schedule.passenger,
            requested_at__date=now.date(),
            pickup_lat__range=(float(schedule.pickup.lat) - 0.003, float(schedule.pickup.lat) + 0.003),
            pickup_lng__range=(float(schedule.pickup.lng) - 0.003, float(schedule.pickup.lng) + 0.003),
            destination_lat__range=(float(schedule.destination.lat) - 0.003, float(schedule.destination.lat) + 0.003),
            destination_lng__range=(float(schedule.destination.lng) - 0.003, float(schedule.destination.lng) + 0.003),
        ).exists()
        if already_requested_today:
            schedule.last_reminded_at = timezone.now()
            schedule.save(update_fields=["last_reminded_at"])
            continue

        notify(
            schedule.passenger,
            title="Your usual ride is coming up",
            body=f"{schedule.pickup.label} → {schedule.destination.label} at {schedule.time_of_day.strftime('%H:%M')}",
            category=Notification.Category.RECURRING_REMINDER,
            link="/",
        )
        schedule.last_reminded_at = timezone.now()
        schedule.save(update_fields=["last_reminded_at"])
        sent += 1

    return sent
