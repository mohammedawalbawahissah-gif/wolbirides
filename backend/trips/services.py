"""
Trip lifecycle orchestration (PRD Section 6.2).

Kept separate from views/serializers so the same logic can be triggered
from a REST endpoint (ride request), a websocket message (driver accept),
or a background task (dispatch timeout cascade) without duplicating the
state machine in three places.
"""

from decimal import Decimal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

from trips.matching import rank_candidate_drivers, trip_group_name, zone_group_name
from trips.models import FareQuote, Trip, TripEvent

DISPATCH_OFFER_TIMEOUT_SECONDS = 18


def _log_event(trip, event_type, payload=None):
    TripEvent.objects.create(trip=trip, event_type=event_type, payload=payload or {})


def _broadcast_trip_update(trip):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        trip_group_name(str(trip.id)),
        {
            "type": "trip_update",
            "data": {
                "trip_id": str(trip.id),
                "status": trip.status,
                "driver_id": str(trip.driver_id) if trip.driver_id else None,
            },
        },
    )


def quote_fare(zone, distance_km):
    """PRD Section 5 FareQuote — placeholder linear model until WR-02 field
    research replaces base_fare/per_km_rate with validated figures."""
    per_km_charge = (Decimal(distance_km) * zone.per_km_rate).quantize(Decimal("0.01"))
    total = zone.base_fare + per_km_charge
    return {
        "distance_km": distance_km,
        "base_fare": zone.base_fare,
        "per_km_charge": per_km_charge,
        "total": total,
    }


def request_trip(passenger, zone, pickup, destination, distance_km):
    """PRD Section 6.2 step 1."""
    trip = Trip.objects.create(
        passenger=passenger,
        zone=zone,
        pickup_lat=pickup["lat"],
        pickup_lng=pickup["lng"],
        pickup_label=pickup.get("label", ""),
        destination_lat=destination["lat"],
        destination_lng=destination["lng"],
        destination_label=destination.get("label", ""),
        status=Trip.Status.REQUESTED,
    )
    fare = quote_fare(zone, distance_km)
    FareQuote.objects.create(
        trip=trip,
        distance_km=fare["distance_km"],
        base_fare=fare["base_fare"],
        per_km_charge=fare["per_km_charge"],
        total=fare["total"],
        expires_at=timezone.now() + timezone.timedelta(minutes=5),
    )
    _log_event(trip, "requested", {"fare_total": str(fare["total"])})
    return trip


def start_dispatch_cascade(trip):
    """
    PRD Section 6.2 steps 2-4: rank candidates, offer to the top-ranked
    driver, and enqueue a timeout check. The timeout re-invocation is
    expected to run via Celery (see wolbirides/celery.py + tasks.py) rather
    than inline — kept as a plain function call here so it's testable
    without a broker.
    """
    trip.status = Trip.Status.MATCHING
    trip.save(update_fields=["status", "updated_at"])
    _log_event(trip, "dispatch_started")

    already_offered = set(trip.events.filter(event_type="offered_to_driver").values_list(
        "payload__driver_id", flat=True
    ))
    candidates = async_to_sync(rank_candidate_drivers)(
        str(trip.zone_id), trip.pickup_lat, trip.pickup_lng, exclude_driver_ids=already_offered
    )

    if not candidates:
        trip.status = Trip.Status.NO_DRIVERS_FOUND
        trip.save(update_fields=["status", "updated_at"])
        _log_event(trip, "no_drivers_found")
        _broadcast_trip_update(trip)
        return None

    next_driver_id = candidates[0]
    _offer_to_driver(trip, next_driver_id)
    return next_driver_id


def _offer_to_driver(trip, driver_id):
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"driver.{driver_id}",
        {
            "type": "ride_request",
            "trip": {
                "trip_id": str(trip.id),
                "pickup_label": trip.pickup_label,
                "destination_label": trip.destination_label,
                "fare_estimate": str(trip.fare_quote.total),
                "timeout_seconds": DISPATCH_OFFER_TIMEOUT_SECONDS,
            },
        },
    )
    _log_event(trip, "offered_to_driver", {"driver_id": driver_id})

    # Import locally to avoid a hard Celery dependency at module import time
    # (keeps `services.py` importable/testable without a broker configured).
    from trips.tasks import check_dispatch_offer_timeout

    check_dispatch_offer_timeout.apply_async(
        args=[str(trip.id), driver_id], countdown=DISPATCH_OFFER_TIMEOUT_SECONDS
    )


def accept_trip(trip, driver):
    """Driver accepted within the offer window."""
    if trip.status != Trip.Status.MATCHING:
        raise ValueError(f"Trip {trip.id} is not awaiting match (status={trip.status})")
    trip.driver = driver
    trip.status = Trip.Status.MATCHED
    trip.matched_at = timezone.now()
    trip.save(update_fields=["driver", "status", "matched_at", "updated_at"])
    _log_event(trip, "matched", {"driver_id": str(driver.id)})
    _broadcast_trip_update(trip)
    return trip


def decline_or_timeout(trip, driver_id):
    """Driver declined, or the offer window expired — cascade to next candidate."""
    _log_event(trip, "declined_or_timed_out", {"driver_id": driver_id})
    return start_dispatch_cascade(trip)


def start_trip(trip):
    trip.status = Trip.Status.IN_PROGRESS
    trip.started_at = timezone.now()
    trip.save(update_fields=["status", "started_at", "updated_at"])
    _log_event(trip, "started")
    _broadcast_trip_update(trip)
    return trip


def complete_trip(trip, fare_final=None):
    trip.status = Trip.Status.COMPLETED
    trip.completed_at = timezone.now()
    trip.fare_final = fare_final or trip.fare_quote.total
    trip.save(update_fields=["status", "completed_at", "fare_final", "updated_at"])
    _log_event(trip, "completed", {"fare_final": str(trip.fare_final)})
    _broadcast_trip_update(trip)
    return trip


def cancel_trip(trip, cancelled_by, reason=""):
    trip.status = Trip.Status.CANCELLED
    trip.cancelled_by = cancelled_by
    trip.cancel_reason = reason
    trip.save(update_fields=["status", "cancelled_by", "cancel_reason", "updated_at"])
    _log_event(trip, "cancelled", {"by": cancelled_by, "reason": reason})
    _broadcast_trip_update(trip)
    return trip


def user_can_access_trip(user, trip):
    if user.role == "admin":
        return True
    if trip.passenger_id == user.id:
        return True
    if trip.driver and trip.driver.user_id == user.id:
        return True
    return False
