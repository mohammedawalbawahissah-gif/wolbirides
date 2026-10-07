"""
Rider passes: riders pay a fixed daily/weekly fee to go online instead of a per-trip commission.

Why a pass and not commission: most early trips are cash, and commission on cash can't be
collected (see payments.services.generate_payout_for_driver). A pass is paid upfront by MoMo
(or cash to ops), so it works whatever the passenger pays with.

Switched on with settings.RIDER_PASS_REQUIRED. While it's off, nothing here blocks anyone, so
ops can recruit and soft-launch first, then switch charging on.
"""
import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from drivers.models import Driver, RiderPass, RiderPassPlan

logger = logging.getLogger(__name__)


class PassError(ValueError):
    pass


def pass_required():
    return bool(getattr(settings, "RIDER_PASS_REQUIRED", False))


def current_pass(driver, at=None):
    """The pass covering `at` (default now), or None."""
    at = at or timezone.now()
    return (driver.passes.filter(status=RiderPass.Status.ACTIVE, starts_at__lte=at, expires_at__gt=at)
            .order_by("-expires_at").first())


def paid_until(driver):
    """End of the last active pass (current or queued), or None. A new pass starts here."""
    last = (driver.passes.filter(status=RiderPass.Status.ACTIVE, expires_at__gt=timezone.now())
            .order_by("-expires_at").first())
    return last.expires_at if last else None


def trial_available(driver):
    return (int(getattr(settings, "RIDER_PASS_TRIAL_DAYS", 14)) > 0
            and driver.verification_status == Driver.VerificationStatus.VERIFIED
            and not driver.passes.filter(source=RiderPass.Source.TRIAL).exists())


def can_go_online(driver):
    """Read-only check (no trial is started): would going online be allowed right now?"""
    return not pass_required() or current_pass(driver) is not None or trial_available(driver)


def ensure_pass_for_online(driver):
    """Called when a rider goes online. If passes are required and the rider has none, their free
    trial starts now, the first time they need it, so it isn't used up during the free soft
    launch before charging begins. Returns True if the rider may go online."""
    if not pass_required() or current_pass(driver) is not None:
        return True
    return grant_trial_if_eligible(driver) is not None


def _activate(rider_pass, *, source=None, recorded_by=None, reference=""):
    """Paid (or granted): it starts now, or right after any pass already running."""
    Driver.objects.select_for_update().filter(id=rider_pass.driver_id).first()  # serialize stacking
    now = timezone.now()
    start = max(paid_until(rider_pass.driver) or now, now)
    rider_pass.status = RiderPass.Status.ACTIVE
    rider_pass.starts_at = start
    rider_pass.expires_at = start + timedelta(days=rider_pass.duration_days)
    if source:
        rider_pass.source = source
    if recorded_by is not None:
        rider_pass.recorded_by = recorded_by
    if reference:
        rider_pass.payment_reference = reference
    rider_pass.save()
    from core.models import notify

    notify(rider_pass.driver.user, "Pass active",
           f"You're covered until {timezone.localtime(rider_pass.expires_at):%a %d %b, %H:%M}.",
           category="driver", link="/profile")
    return rider_pass


@transaction.atomic
def grant_trial_if_eligible(driver):
    """One free trial pass of RIDER_PASS_TRIAL_DAYS per rider, ever."""
    days = int(getattr(settings, "RIDER_PASS_TRIAL_DAYS", 14))
    Driver.objects.select_for_update().filter(id=driver.id).first()
    if not trial_available(driver):
        return None
    trial = RiderPass(driver=driver, source=RiderPass.Source.TRIAL, duration_days=days, price_paid=Decimal("0.00"))
    return _activate(trial)


def start_purchase(driver, plan, phone):
    """Creates a pending pass and asks MoMo to collect. Without live MoMo credentials (dev), it
    behaves like bundle purchases: a dev reference, settled on the next refresh."""
    from payments import momo

    if driver.verification_status != Driver.VerificationStatus.VERIFIED:
        raise PassError("Only verified riders can buy a pass.")
    if not plan.active:
        raise PassError("That pass isn't on sale.")
    if not phone:
        raise PassError("A MoMo number is needed to pay.")
    rider_pass = RiderPass.objects.create(
        driver=driver, plan=plan, source=RiderPass.Source.MOMO, duration_days=plan.duration_days,
        price_paid=plan.price, payer_phone=phone,
    )
    if not momo.enabled(momo.COLLECTION):
        rider_pass.payment_reference = f"dev-{uuid.uuid4().hex[:12]}"
        rider_pass.save(update_fields=["payment_reference", "updated_at"])
        logger.info("[DEV MOMO] would charge %s GH₵%s for rider pass %s", phone, plan.price, rider_pass.id)
        return rider_pass
    try:
        accepted = momo.request_to_pay(
            amount=plan.price, phone=phone, external_id=f"riderpass:{rider_pass.id}",
            payer_message=f"WolbiRides {plan.name}", payee_note=f"Pass {str(rider_pass.id)[:8]}",
        )
    except momo.MoMoError as exc:
        rider_pass.status = RiderPass.Status.CANCELLED
        rider_pass.save(update_fields=["status", "updated_at"])
        raise PassError(f"MoMo couldn't start the payment: {exc}") from exc
    rider_pass.payment_reference = accepted.reference_id
    rider_pass.save(update_fields=["payment_reference", "updated_at"])
    return rider_pass


@transaction.atomic
def refresh_purchase(rider_pass):
    """Polls MoMo (or the callback calls this). Idempotent: an already-settled pass is returned as is."""
    from payments import momo

    rider_pass = RiderPass.objects.select_for_update().get(id=rider_pass.id)
    if rider_pass.status != RiderPass.Status.PENDING_PAYMENT or not rider_pass.payment_reference:
        return rider_pass
    if not momo.enabled(momo.COLLECTION):
        payload = {"status": "SUCCESSFUL"} if settings.MOMO_DEV_AUTO_APPROVE else {"status": "PENDING"}
    else:
        try:
            payload = momo.get_status(momo.COLLECTION, rider_pass.payment_reference)
        except momo.MoMoError as exc:
            logger.warning("MoMo status check failed for rider pass %s: %s", rider_pass.id, exc)
            return rider_pass
    status = payload.get("status")
    if status == "SUCCESSFUL":
        return _activate(rider_pass)
    if status in ("FAILED", "REJECTED", "TIMEOUT"):
        rider_pass.status = RiderPass.Status.CANCELLED
        rider_pass.save(update_fields=["status", "updated_at"])
    return rider_pass


@transaction.atomic
def record_offline_pass(driver, plan, *, admin, source=RiderPass.Source.CASH, days=None):
    """Ops records a pass paid in cash to them, or grants one (e.g. a longer trial, an apology).
    Cash uses the plan's price; a grant is free and may set its own length."""
    if source not in (RiderPass.Source.CASH, RiderPass.Source.GRANT):
        raise PassError("Ops can only record cash payments or grants.")
    if source == RiderPass.Source.CASH and plan is None:
        raise PassError("A cash payment needs a plan.")
    duration = days or (plan.duration_days if plan else None)
    if not duration or duration < 1:
        raise PassError("Say how many days the grant lasts.")
    rider_pass = RiderPass(
        driver=driver, plan=plan, source=source, duration_days=duration,
        price_paid=plan.price if (plan and source == RiderPass.Source.CASH) else Decimal("0.00"),
    )
    return _activate(rider_pass, recorded_by=admin)


def expire_passes_and_enforce():
    """Beat task body: marks ended passes expired and, when passes are required, takes offline
    any online rider with no current pass. Returns how many riders were taken offline."""
    from drivers.services import take_driver_offline

    now = timezone.now()
    RiderPass.objects.filter(status=RiderPass.Status.ACTIVE, expires_at__lte=now).update(
        status=RiderPass.Status.EXPIRED, updated_at=now)
    # Abandoned MoMo prompts: never approved within a day.
    RiderPass.objects.filter(status=RiderPass.Status.PENDING_PAYMENT,
                             created_at__lt=now - timedelta(days=1)).update(
        status=RiderPass.Status.CANCELLED, updated_at=now)
    if not pass_required():
        return 0
    covered = RiderPass.objects.filter(status=RiderPass.Status.ACTIVE, starts_at__lte=now,
                                       expires_at__gt=now).values("driver_id")
    lapsed = Driver.objects.filter(is_online=True).exclude(id__in=covered)
    count = 0
    from core.models import notify

    for driver in lapsed.select_related("user"):
        if ensure_pass_for_online(driver):
            continue  # was online before charging started: their trial begins now
        take_driver_offline(driver, reason="pass_expired")
        notify(driver.user, "Pass ended", "Your pass has ended. Buy a new one to go back online.",
               category="driver", link="/profile")
        count += 1
    return count


def pass_status(driver):
    """What the rider apps show: whether passes are on, the current pass, and plans for sale."""
    now_pass = current_pass(driver)
    until = paid_until(driver)
    return {
        "required": pass_required(),
        "can_go_online": can_go_online(driver),
        "trial_available": trial_available(driver),
        "trial_days": int(getattr(settings, "RIDER_PASS_TRIAL_DAYS", 14)),
        "current": serialize_pass(now_pass) if now_pass else None,
        "paid_until": until.isoformat() if until else None,
        "plans": [
            {"id": str(p.id), "name": p.name, "duration_days": p.duration_days, "price": str(p.price)}
            for p in RiderPassPlan.objects.filter(active=True)
        ],
        "recent": [serialize_pass(p) for p in driver.passes.all()[:10]],
    }


def serialize_pass(p):
    return {
        "id": str(p.id), "source": p.source, "status": p.status, "plan": p.plan.name if p.plan else None,
        "duration_days": p.duration_days, "price_paid": str(p.price_paid),
        "starts_at": p.starts_at.isoformat() if p.starts_at else None,
        "expires_at": p.expires_at.isoformat() if p.expires_at else None,
    }
