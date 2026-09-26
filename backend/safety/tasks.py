from celery import shared_task


@shared_task
def run_safety_checks():
    from safety.services import run_safety_checks as run

    return run()
