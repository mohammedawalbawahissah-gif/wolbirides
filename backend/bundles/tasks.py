from celery import shared_task


@shared_task
def expire_bundles():
    from bundles.services import expire_bundles as run

    return run()
