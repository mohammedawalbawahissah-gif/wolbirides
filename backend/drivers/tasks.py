from celery import shared_task


@shared_task
def enforce_rider_passes():
    """Every minute (CELERY_BEAT_SCHEDULE): expire ended passes, take lapsed riders offline."""
    from drivers.passes import expire_passes_and_enforce

    return expire_passes_and_enforce()
