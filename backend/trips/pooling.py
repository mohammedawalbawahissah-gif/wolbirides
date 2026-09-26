"""
WR-17 ride pooling for shared corridors.

Opt-in only (`shareable`). A request shares a yellow-yellow with at most one
other rider (POOL_MAX_RIDERS = 2) when both:
  - were requested within POOL_JOIN_WINDOW_MINUTES of each other,
  - are picked up within POOL_PICKUP_RADIUS_KM, and
  - are headed within POOL_DESTINATION_RADIUS_KM.

Two ways to share:
  1. Pair with another shareable rider who is *still searching* (the
     top-of-the-hour rush). The first request's dispatch carries both; the new
     rider waits on it. If it finds no driver, the waiting rider is dispatched
     on their own. Nobody waits for a pool that never forms.
  2. Join a group whose driver is already heading out, while neither rider
     has been picked up yet (no surprise detours for someone on board).

Fare split (PRD): the base fare is shared, and each rider pays the distance
charge for their own leg. A rider never pays more than their solo fare, and
pays exactly the solo fare if nobody ends up sharing.
"""
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from trips.matching import haversine_km
from trips.models import PoolGroup, Trip, TripEvent

WAITING_FOR_PICKUP = [Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING]
ENDED = [Trip.Status.CANCELLED, Trip.Status.NO_DRIVERS_FOUND, Trip.Status.COMPLETED]


def max_riders():
    return getattr(settings, "POOL_MAX_RIDERS", 2)


def _close(a_lat, a_lng, b_lat, b_lng, radius):
    return haversine_km(float(a_lat), float(a_lng), float(b_lat), float(b_lng)) <= radius


def compatible(a, b):
    window = timezone.timedelta(minutes=settings.POOL_JOIN_WINDOW_MINUTES)
    return (
        a.passenger_id != b.passenger_id
        and a.zone_id == b.zone_id
        and abs(a.requested_at - b.requested_at) <= window
        and _close(a.pickup_lat, a.pickup_lng, b.pickup_lat, b.pickup_lng, settings.POOL_PICKUP_RADIUS_KM)
        and _close(a.destination_lat, a.destination_lng, b.destination_lat, b.destination_lng,
                   settings.POOL_DESTINATION_RADIUS_KM)
    )


def _riders(group):
    return list(group.trips.exclude(status__in=ENDED).order_by("requested_at"))


def try_pool(trip):
    """Returns ("joined", driver), ("waiting", lead_trip) or None."""
    cutoff = timezone.now() - timezone.timedelta(minutes=settings.POOL_JOIN_WINDOW_MINUTES)

    # 1. A driver already heading to a shareable rider nearby.
    for group in PoolGroup.objects.filter(zone=trip.zone, status=PoolGroup.Status.OPEN,
                                          driver__isnull=False, created_at__gte=cutoff).order_by("created_at"):
        with transaction.atomic():
            locked = PoolGroup.objects.select_for_update().get(id=group.id)
            fresh = Trip.objects.select_for_update().get(id=trip.id)
            riders = _riders(locked)
            if (locked.status != PoolGroup.Status.OPEN or fresh.status != Trip.Status.REQUESTED
                    or not riders or len(riders) >= max_riders()
                    or any(r.status not in WAITING_FOR_PICKUP for r in riders)
                    or not all(compatible(r, fresh) for r in riders)):
                continue
            fresh.pool_group, fresh.driver = locked, locked.driver
            fresh.status, fresh.matched_at = Trip.Status.MATCHED, timezone.now()
            fresh.save(update_fields=["pool_group", "driver", "status", "matched_at", "updated_at"])
            TripEvent.objects.create(trip=fresh, event_type="joined_pool",
                                     payload={"pool_group": str(locked.id), "driver_user_id": str(locked.driver.user_id)})
            reprice(locked)
        _announce_join(fresh, locked.driver)
        trip.refresh_from_db()
        return ("joined", locked.driver)

    # 2. Another shareable rider still searching for a driver.
    counterparts = Trip.objects.filter(
        zone=trip.zone, shareable=True, status=Trip.Status.MATCHING, driver__isnull=True,
        requested_at__gte=cutoff, trip_type=Trip.Kind.RIDE,
    ).exclude(id=trip.id).exclude(passenger_id=trip.passenger_id).order_by("requested_at")
    for lead in counterparts:
        with transaction.atomic():
            lead = Trip.objects.select_for_update().get(id=lead.id)
            fresh = Trip.objects.select_for_update().get(id=trip.id)
            if lead.status != Trip.Status.MATCHING or lead.driver_id or fresh.status != Trip.Status.REQUESTED:
                continue
            group = lead.pool_group or PoolGroup.objects.create(zone=lead.zone)
            members = _riders(group) if lead.pool_group_id else [lead]
            if len(members) >= max_riders() or not all(compatible(m, fresh) for m in members):
                continue
            if not lead.pool_group_id:
                lead.pool_group = group
                lead.save(update_fields=["pool_group", "updated_at"])
            fresh.pool_group = group
            fresh.status = Trip.Status.MATCHING
            fresh.save(update_fields=["pool_group", "status", "updated_at"])
            TripEvent.objects.create(trip=fresh, event_type="waiting_on_pool",
                                     payload={"pool_group": str(group.id), "lead_trip": str(lead.id)})
        from trips.services import _broadcast_trip_update

        _broadcast_trip_update(fresh)
        trip.refresh_from_db()
        return ("waiting", lead)
    return None


def on_accept(trip, driver):
    """Inside accept_trip's transaction. Returns the other riders matched with this driver."""
    joined = []
    if trip.pool_group_id:
        group = PoolGroup.objects.select_for_update().get(id=trip.pool_group_id)
        group.driver, group.matched_at = driver, timezone.now()
        group.save(update_fields=["driver", "matched_at", "updated_at"])
        for other in group.trips.filter(status=Trip.Status.MATCHING, driver__isnull=True).exclude(id=trip.id):
            other.driver, other.status, other.matched_at = driver, Trip.Status.MATCHED, timezone.now()
            other.save(update_fields=["driver", "status", "matched_at", "updated_at"])
            TripEvent.objects.create(trip=other, event_type="matched",
                                     payload={"driver_id": str(driver.id), "driver_user_id": str(driver.user_id),
                                              "via_pool_group": str(group.id)})
            joined.append(other)
        reprice(group)
    elif trip.shareable:
        trip.pool_group = PoolGroup.objects.create(driver=driver, zone=trip.zone, matched_at=timezone.now())
        trip.save(update_fields=["pool_group", "updated_at"])
    return joined


def on_trip_ended(trip):
    """A rider in a group cancelled or found no driver. Keep everyone else moving and
    re-price, so a rider left alone pays their solo fare again (never more)."""
    if not trip.pool_group_id:
        return
    group = trip.pool_group
    remaining = _riders(group)
    if group.driver_id is None:
        # The trip carrying this group's dispatch is gone; waiting riders dispatch themselves.
        from trips.services import _dispatch

        waiting = [r for r in remaining if r.status == Trip.Status.MATCHING and r.driver_id is None
                   and not r.events.filter(event_type="offered_to_driver").exists()]
        if waiting:
            nxt = waiting[0]
            TripEvent.objects.create(trip=nxt, event_type="pool_partner_left", payload={})
            _dispatch(nxt)
            return
    reprice(group)


def reprice(group):
    """Base fare shared equally, each rider pays their own distance charge; never above solo."""
    riders = _riders(group)
    for r in riders:
        q = r.fare_quote
        if len(riders) < 2:
            seat = None
        else:
            pooled = (q.base_fare / len(riders)).quantize(Decimal("0.01")) + q.per_km_charge + q.surcharge - q.discount
            seat = min(max(pooled, Decimal("0.00")), q.total)
        if r.pool_seat_fare != seat:
            r.pool_seat_fare = seat
            r.save(update_fields=["pool_seat_fare", "updated_at"])


def _announce_join(trip, driver):
    from core.models import notify
    from trips.services import _broadcast_trip_update

    _broadcast_trip_update(trip)
    notify(trip.passenger, "Shared ride matched",
           f"{driver.user.name or 'Your driver'} is picking up one other rider going your way.",
           category="trip", link=f"/trip/{trip.id}")
    notify(driver.user, "Second rider added",
           f"Also pick up {(trip.passenger.name or 'a rider').split(' ')[0]} at {trip.pickup_label or 'a nearby pickup'}.",
           category="trip", link=f"/active-trip/{trip.id}")


def ordered_stops(riders):
    """PRD: the driver sees both pickups then both drop-offs, in order, not one ambiguous trip.
    Pickups in request order; drop-offs nearest-first from the last pickup."""
    pickups = [{"type": "pickup", "trip_id": str(r.id), "first_name": (r.passenger.name or "Rider").split(" ")[0],
                "label": r.pickup_label, "lat": str(r.pickup_lat), "lng": str(r.pickup_lng),
                "fare": str(r.pool_seat_fare or r.fare_quote.total),
                "done": r.status in (Trip.Status.IN_PROGRESS, Trip.Status.COMPLETED)} for r in riders]
    last = riders[-1] if riders else None
    drops = sorted(riders, key=lambda r: haversine_km(float(last.pickup_lat), float(last.pickup_lng),
                                                       float(r.destination_lat), float(r.destination_lng)))
    dropoffs = [{"type": "dropoff", "trip_id": str(r.id), "first_name": (r.passenger.name or "Rider").split(" ")[0],
                 "label": r.destination_label, "lat": str(r.destination_lat), "lng": str(r.destination_lng),
                 "fare": str(r.pool_seat_fare or r.fare_quote.total),
                 "done": r.status == Trip.Status.COMPLETED} for r in drops]
    return pickups + dropoffs


def offer_legs(trip):
    """For an offer that carries a waiting rider too: the whole sequence, so the driver knows it's two stops."""
    if not trip.pool_group_id:
        return None
    riders = _riders(trip.pool_group)
    if len(riders) < 2:
        return None
    # Offer shows what the driver would earn if both ride: shared-base pricing.
    shadow = []
    for r in riders:
        q = r.fare_quote
        r.pool_seat_fare = min((q.base_fare / len(riders)).quantize(Decimal("0.01")) + q.per_km_charge
                               + q.surcharge - q.discount, q.total)
        shadow.append(r)
    return ordered_stops(shadow)


def pool_summary(trip, for_driver=False):
    if not trip.pool_group_id:
        return None
    riders = _riders(trip.pool_group) or [trip]
    info = {"pool_group": str(trip.pool_group_id), "open": trip.pool_group.status == PoolGroup.Status.OPEN,
            "rider_count": len(riders)}
    if for_driver:
        info["stops"] = ordered_stops(riders)
    return info
