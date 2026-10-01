from decimal import Decimal

from django.utils import timezone

from partners.models import Partner, PromoCode, PromoRedemption

PARTNER_RADIUS_KM = 0.2


class PromoError(ValueError):
    pass


def compute_discount(promo, user, fare_total, destination=None, lock=False):
    """Returns the GH₵ discount, or raises PromoError with a passenger-friendly reason."""
    now = timezone.now()
    if not promo.active or (promo.valid_from and now < promo.valid_from) or (promo.valid_until and now > promo.valid_until):
        raise PromoError("That code isn't active right now.")
    if fare_total < promo.min_fare:
        raise PromoError(f"That code needs a fare of at least GH₵{promo.min_fare}.")
    used = PromoRedemption.objects.filter(promo=promo, status=PromoRedemption.Status.APPLIED)
    if promo.max_uses is not None and used.count() >= promo.max_uses:
        raise PromoError("That code has been fully used.")
    if used.filter(user=user).count() >= promo.max_uses_per_user:
        raise PromoError("You've already used that code.")
    if promo.destination_must_be_partner:
        if not promo.partner or not destination or not is_near_partner(promo.partner, *destination):
            raise PromoError(f"That code only works for trips to {promo.partner.name if promo.partner else 'the partner'}.")

    if promo.discount_type == PromoCode.DiscountType.PERCENT:
        amount = (fare_total * promo.value / Decimal("100")).quantize(Decimal("0.01"))
    else:
        amount = promo.value
    if promo.max_discount is not None:
        amount = min(amount, promo.max_discount)
    return min(amount, fare_total)


def find_promo(code, lock=False):
    qs = PromoCode.objects.all()
    if lock:
        qs = qs.select_for_update()
    promo = qs.filter(code=(code or "").strip().upper()).first()
    if not promo:
        raise PromoError("We don't recognise that code.")
    return promo


def is_near_partner(partner, lat, lng):
    from trips.matching import haversine_km

    return haversine_km(float(lat), float(lng), float(partner.lat), float(partner.lng)) <= PARTNER_RADIUS_KM


def void_for_trip(trip):
    PromoRedemption.objects.filter(trip=trip, status=PromoRedemption.Status.APPLIED).update(
        status=PromoRedemption.Status.VOID
    )


def partner_report(since):
    """Per partner: completed trips ending there, promo redemptions and discount given."""
    from trips.models import Trip

    completed = list(Trip.objects.filter(status=Trip.Status.COMPLETED, completed_at__gte=since)
                     .values("destination_lat", "destination_lng", "zone_id"))
    rows = []
    for partner in Partner.objects.filter(active=True).select_related("zone"):
        arrivals = sum(1 for t in completed if t["zone_id"] == partner.zone_id
                       and is_near_partner(partner, t["destination_lat"], t["destination_lng"]))
        redemptions = PromoRedemption.objects.filter(
            promo__partner=partner, status=PromoRedemption.Status.APPLIED, created_at__gte=since,
            trip__status=Trip.Status.COMPLETED,
        )
        rows.append({
            "partner_id": str(partner.id), "name": partner.name, "category": partner.category,
            "rides_to_partner": arrivals, "promo_redemptions": redemptions.count(),
            "discount_given": str(sum((r.amount for r in redemptions), Decimal("0.00"))),
        })
    return sorted(rows, key=lambda r: -r["rides_to_partner"])
