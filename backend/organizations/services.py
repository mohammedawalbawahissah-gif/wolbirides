from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from organizations.models import BalanceEntry, Invoice, Organization, OrganizationMember, RideVoucher


class OrganizationBillingError(ValueError):
    pass


def month_start(today=None):
    today = today or timezone.localdate()
    return today.replace(day=1)


def _spend(trips):
    """Completed trips count at their final fare; in-flight trips at their quote, so two
    simultaneous bookings can't both squeeze under the cap."""
    from trips.models import Trip

    trips = trips.exclude(status__in=[Trip.Status.CANCELLED, Trip.Status.NO_DRIVERS_FOUND])
    done = trips.filter(status=Trip.Status.COMPLETED).aggregate(s=Coalesce(Sum("fare_final"), Decimal("0")))["s"]
    open_ = trips.exclude(status=Trip.Status.COMPLETED).aggregate(s=Coalesce(Sum("fare_quote__total"), Decimal("0")))["s"]
    return done + open_


def active_memberships(user):
    return OrganizationMember.objects.filter(user=user, active=True, organization__active=True).select_related("organization")


def member_allowance(membership):
    """Remaining GH₵ this member can bill to the org this month (None = unlimited)."""
    from trips.models import Trip

    org = membership.organization
    start = month_start()
    remaining = []
    if org.monthly_budget is not None:
        spent = _spend(Trip.objects.filter(organization=org, requested_at__date__gte=start))
        remaining.append(org.monthly_budget - spent)
    if membership.monthly_limit is not None:
        spent = _spend(Trip.objects.filter(organization=org, passenger=membership.user, requested_at__date__gte=start))
        remaining.append(membership.monthly_limit - spent)
    return min(remaining) if remaining else None


def _check_prepaid(org, fare_total):
    """A pre-funded organization can't go below zero, counting rides already booked."""
    if org.prepaid_balance is None:
        return
    from trips.models import Trip

    in_flight = Trip.objects.filter(organization=org).exclude(
        status__in=[Trip.Status.CANCELLED, Trip.Status.NO_DRIVERS_FOUND, Trip.Status.COMPLETED]
    ).aggregate(s=Coalesce(Sum("fare_quote__total"), Decimal("0")))["s"]
    if org.prepaid_balance - in_flight < fare_total:
        raise OrganizationBillingError(
            f"{org.name}'s prepaid ride balance is too low for this trip. Choose another way to pay."
        )


def check_can_bill(user, organization_id, fare_total):
    membership = active_memberships(user).filter(organization_id=organization_id).first()
    if not membership:
        raise OrganizationBillingError("You're not an active member of that organization.")
    _check_prepaid(membership.organization, fare_total)
    allowance = member_allowance(membership)
    if allowance is not None and fare_total > allowance:
        raise OrganizationBillingError(
            f"This trip (GH₵{fare_total}) is over your remaining allowance for {membership.organization.name} "
            f"this month (GH₵{max(allowance, Decimal('0')):.2f}). Choose another way to pay."
        )
    return membership.organization


def generate_invoice(organization, period_start: date, period_end: date):
    """Idempotent: re-running for a period returns the existing invoice."""
    from trips.models import Trip

    existing = Invoice.objects.filter(organization=organization, period_start=period_start, period_end=period_end).first()
    if existing:
        return existing
    trips = Trip.objects.filter(
        organization=organization, status=Trip.Status.COMPLETED,
        completed_at__date__gte=period_start, completed_at__date__lt=period_end,
    ).select_related("passenger").order_by("completed_at")
    items, total = [], Decimal("0.00")
    for t in trips:
        total += t.fare_final
        items.append({
            "trip_id": str(t.id), "date": t.completed_at.date().isoformat(),
            "rider": t.passenger.name or t.passenger.phone, "trip_type": t.trip_type,
            "paid_with": "voucher" if t.voucher_id else "account",
            "from": t.pickup_label, "to": t.destination_label, "fare": str(t.fare_final),
        })
    return Invoice.objects.create(organization=organization, period_start=period_start, period_end=period_end,
                                  total=total, line_items=items)


def generate_last_month_invoices():
    this_month = month_start()
    last_month = (this_month - timezone.timedelta(days=1)).replace(day=1)
    return [generate_invoice(org, last_month, this_month) for org in Organization.objects.filter(active=True)]


# --- WR-21 vouchers -------------------------------------------------------------

VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I confusion when read aloud


def _new_code():
    import secrets

    return "WR-" + "".join(secrets.choice(VOUCHER_ALPHABET) for _ in range(6))


def issue_vouchers(organization, count, kind, value=None, ride_count=None, expires_at=None):
    if kind == RideVoucher.Kind.VALUE and not value:
        raise OrganizationBillingError("Value vouchers need a GH₵ amount.")
    if kind == RideVoucher.Kind.RIDES and not ride_count:
        raise OrganizationBillingError("Ride vouchers need a number of rides.")
    created = []
    for _ in range(min(int(count), 500)):
        code = _new_code()
        while RideVoucher.objects.filter(code=code).exists():
            code = _new_code()
        created.append(RideVoucher.objects.create(
            organization=organization, code=code, kind=kind,
            value=value if kind == RideVoucher.Kind.VALUE else None,
            value_remaining=value if kind == RideVoucher.Kind.VALUE else None,
            ride_count=ride_count if kind == RideVoucher.Kind.RIDES else None,
            rides_remaining=ride_count if kind == RideVoucher.Kind.RIDES else None,
            expires_at=expires_at,
        ))
    return created


def _usable(voucher):
    now = timezone.now()
    if voucher.voided or not voucher.organization.active:
        return False
    if voucher.expires_at and voucher.expires_at < now:
        return False
    if voucher.kind == RideVoucher.Kind.RIDES:
        return (voucher.rides_remaining or 0) > 0
    return (voucher.value_remaining or 0) > 0


def redeem_voucher(user, code):
    """POST /api/vouchers/redeem: the first person to redeem a code owns it."""
    code = (code or "").strip().upper()
    with transaction.atomic():
        voucher = RideVoucher.objects.select_for_update().select_related("organization").filter(code=code).first()
        if not voucher or not _usable(voucher):
            raise OrganizationBillingError("That voucher code isn't valid, or has expired.")
        if voucher.redeemed_by_id and voucher.redeemed_by_id != user.id:
            raise OrganizationBillingError("That voucher has already been used by someone else.")
        if not voucher.redeemed_by_id:
            voucher.redeemed_by, voucher.redeemed_at = user, timezone.now()
            voucher.save(update_fields=["redeemed_by", "redeemed_at", "updated_at"])
    return voucher


def usable_vouchers(user):
    return [v for v in RideVoucher.objects.filter(redeemed_by=user, voided=False).select_related("organization")
            if _usable(v)]


def reserve_voucher(user, voucher_id, trip, fare_total):
    """Holds this trip's cost on the voucher. Runs inside the trip-request transaction."""
    voucher = RideVoucher.objects.select_for_update().select_related("organization").filter(
        id=voucher_id, redeemed_by=user).first()
    if not voucher or not _usable(voucher):
        raise OrganizationBillingError("That voucher can't be used.")
    if voucher.kind == RideVoucher.Kind.RIDES:
        voucher.rides_remaining -= 1
        voucher.save(update_fields=["rides_remaining", "updated_at"])
    else:
        if fare_total > voucher.value_remaining:
            raise OrganizationBillingError(
                f"This trip (GH₵{fare_total}) is more than the GH₵{voucher.value_remaining} left on your voucher. "
                f"Choose another way to pay."
            )
        voucher.value_remaining -= fare_total
        voucher.save(update_fields=["value_remaining", "updated_at"])
    _check_prepaid(voucher.organization, fare_total)
    return voucher


def settle_voucher(trip, completed):
    """On completion, refund any difference between the held quote and the final fare
    (e.g. a shared-ride discount); on cancellation, return the hold in full."""
    if not trip.voucher_id:
        return
    with transaction.atomic():
        voucher = RideVoucher.objects.select_for_update().get(id=trip.voucher_id)
        held = trip.fare_quote.total
        if voucher.kind == RideVoucher.Kind.RIDES:
            if not completed:
                voucher.rides_remaining += 1
        else:
            voucher.value_remaining += (held - trip.fare_final) if completed else held
        voucher.save(update_fields=["rides_remaining", "value_remaining", "updated_at"])


def charge_prepaid_balance(trip):
    """Completed org/voucher trip: draw it from a pre-funded organization's balance."""
    with transaction.atomic():
        org = Organization.objects.select_for_update().get(id=trip.organization_id)
        if org.prepaid_balance is None:
            return
        org.prepaid_balance -= trip.fare_final
        org.save(update_fields=["prepaid_balance", "updated_at"])
        BalanceEntry.objects.create(organization=org, amount=-trip.fare_final, reason="ride", trip=trip)


def top_up(org, amount, reference=""):
    amount = Decimal(str(amount))
    if amount <= 0:
        raise OrganizationBillingError("Top-up must be more than zero.")
    with transaction.atomic():
        org = Organization.objects.select_for_update().get(id=org.id)
        org.prepaid_balance = (org.prepaid_balance or Decimal("0")) + amount
        org.save(update_fields=["prepaid_balance", "updated_at"])
        BalanceEntry.objects.create(organization=org, amount=amount, reason="top_up", reference=reference)
    return org
