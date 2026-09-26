from celery import shared_task
from django.utils import timezone


@shared_task
def run_weekly_payout_batch():
    """
    WR-14. Scheduled for Monday 00:05 UTC (see CELERY_BEAT_SCHEDULE),
    covering the just-finished Mon-Sun week. Generation only — payouts sit
    in PENDING for admin approval before disbursement during the pilot
    (see PayoutBatchApproveView), matching WR-06.1's founder-run-ops
    pattern for anything touching real money this early.
    """
    from payments.services import generate_weekly_payouts

    today = timezone.localdate()
    period_end = today  # exclusive
    period_start = period_end - timezone.timedelta(days=7)
    payouts = generate_weekly_payouts(period_start, period_end)
    return {"period_start": str(period_start), "period_end": str(period_end), "payouts_generated": len(payouts)}


@shared_task(bind=True, max_retries=3, default_retry_delay=300)
def disburse_payout_task(self, payout_id):
    """
    Runs the actual disbursement for one approved payout, with retry on
    failure (5 min backoff, up to 3 attempts) rather than a single
    silent failure a driver would have no visibility into.
    """
    from payments.models import Payout
    from payments.services import disburse_payout

    try:
        payout = Payout.objects.get(id=payout_id)
    except Payout.DoesNotExist:
        return

    result = disburse_payout(payout)
    if result.status == Payout.Status.FAILED and self.request.retries < self.max_retries:
        raise self.retry()
    return result.status


@shared_task
def check_processing_payouts():
    """Every few minutes: settle payouts MTN accepted but hasn't finished (backs up the callback)."""
    from payments.models import Payout
    from payments.services import check_payout_status

    done = 0
    for payout in Payout.objects.filter(status=Payout.Status.PROCESSING)[:100]:
        if check_payout_status(payout).status != Payout.Status.PROCESSING:
            done += 1
    return done
