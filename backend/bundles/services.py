from django.db import transaction
from django.db.models import F
from django.utils import timezone

from bundles.models import BundleRedemption, PassengerBundle


class BundleError(ValueError):
    pass


def expires_before_term(plan):
    from django.conf import settings

    return plan.valid_days is not None and plan.valid_days < settings.BUNDLE_MIN_TERM_DAYS


def start_purchase(user, plan, payment_method="momo", acknowledged_short_expiry=False):
    """WR-22 guardrail: a bundle that expires before a full academic term can only be
    bought after the passenger has explicitly acknowledged the expiry date."""
    if expires_before_term(plan) and not acknowledged_short_expiry:
        raise BundleError(
            f"This bundle expires {plan.valid_days} days after purchase, before the end of a term. "
            f"Confirm you understand the expiry to continue."
        )
    return PassengerBundle.objects.create(
        user=user, plan=plan, rides_total=plan.ride_count, rides_remaining=plan.ride_count,
        price_paid=plan.price, max_fare_per_ride=plan.max_fare_per_ride, payment_method=payment_method,
        short_expiry_acknowledged=bool(acknowledged_short_expiry),
    )


def activate(bundle, payment_reference=""):
    """Called when payment is confirmed (MoMo webhook, or ops confirming a cash/office payment)."""
    if bundle.status != PassengerBundle.Status.PENDING_PAYMENT:
        raise BundleError(f"Bundle is {bundle.status}, not awaiting payment.")
    now = timezone.now()
    bundle.status = PassengerBundle.Status.ACTIVE
    bundle.activated_at = now
    bundle.expires_at = now + timezone.timedelta(days=bundle.plan.valid_days) if bundle.plan.valid_days else None
    bundle.payment_reference = payment_reference or bundle.payment_reference
    bundle.save(update_fields=["status", "activated_at", "expires_at", "payment_reference", "updated_at"])
    from core.models import notify

    until = f"Valid until {bundle.expires_at:%d %b %Y}." if bundle.expires_at else "No expiry."
    notify(bundle.user, "Bundle ready", f"{bundle.rides_total} rides added. {until}",
           category="system", link="/profile")
    return bundle


def reserve_ride(user, bundle_id, trip, fare_total):
    """Takes one ride credit for this trip. Must run inside the trip-request transaction."""
    bundle = PassengerBundle.objects.select_for_update().filter(id=bundle_id, user=user).first()
    if not bundle or bundle.status != PassengerBundle.Status.ACTIVE:
        raise BundleError("That bundle isn't active.")
    if bundle.expires_at and bundle.expires_at < timezone.now():
        raise BundleError("That bundle has expired.")
    if bundle.rides_remaining < 1:
        raise BundleError("That bundle has no rides left.")
    if trip.trip_type != "ride":
        raise BundleError("Bundles cover rides, not deliveries.")
    if fare_total > bundle.max_fare_per_ride:
        raise BundleError(
            f"This trip (GH₵{fare_total}) is above your bundle's limit of GH₵{bundle.max_fare_per_ride} per ride. "
            f"Choose another way to pay."
        )
    PassengerBundle.objects.filter(id=bundle.id).update(rides_remaining=F("rides_remaining") - 1)
    BundleRedemption.objects.create(bundle=bundle, trip=trip)
    return bundle


def settle_for_trip(trip, completed):
    """On completion the credit is used; on cancellation it goes back."""
    redemption = BundleRedemption.objects.filter(trip=trip, status=BundleRedemption.Status.RESERVED).first()
    if not redemption:
        return
    with transaction.atomic():
        bundle = PassengerBundle.objects.select_for_update().get(id=redemption.bundle_id)
        if completed:
            redemption.status = BundleRedemption.Status.USED
            if bundle.rides_remaining == 0:
                bundle.status = PassengerBundle.Status.EXHAUSTED
                bundle.save(update_fields=["status", "updated_at"])
        else:
            redemption.status = BundleRedemption.Status.RELEASED
            bundle.rides_remaining += 1
            if bundle.status == PassengerBundle.Status.EXHAUSTED:
                bundle.status = PassengerBundle.Status.ACTIVE
            bundle.save(update_fields=["rides_remaining", "status", "updated_at"])
        redemption.save(update_fields=["status", "updated_at"])


def expire_bundles():
    return PassengerBundle.objects.filter(
        status=PassengerBundle.Status.ACTIVE, expires_at__lt=timezone.now()
    ).update(status=PassengerBundle.Status.EXPIRED)


def usable_bundles(user):
    """Active bundles with rides left, in the order they were bought (the order they're used)."""
    from django.db.models import Q

    return PassengerBundle.objects.filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()),
        user=user, status=PassengerBundle.Status.ACTIVE, rides_remaining__gt=0,
    ).select_related("plan").order_by("activated_at", "created_at")


def auto_reserve(user, trip, fare_total):
    """WR-22: with no payment chosen, the oldest bundle that covers this ride pays for it.
    Returns the bundle, or None to fall back to paying per trip."""
    if trip.trip_type != "ride":
        return None
    for bundle in usable_bundles(user):
        if fare_total <= bundle.max_fare_per_ride:
            try:
                return reserve_ride(user, bundle.id, trip, fare_total)
            except BundleError:
                continue
    return None
