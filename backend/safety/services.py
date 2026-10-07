import logging
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from safety.models import SafetyCheckIn, TripShare

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = ("matched", "driver_arriving", "in_progress")
SHARE_GRACE_AFTER_END = timedelta(minutes=30)


# --- Trip sharing -------------------------------------------------------

def share_url(share):
    return f"{settings.PASSENGER_WEB_URL.rstrip('/')}/share/{share.token}"


def create_share(trip, user, send_to_contact=False):
    share = TripShare.objects.create(trip=trip, created_by=user)
    if not trip.shared_with_contact:
        trip.shared_with_contact = True
        trip.save(update_fields=["shared_with_contact", "updated_at"])
    already_texted = TripShare.objects.filter(
        trip=trip, created_by=user, sent_to_phone=user.emergency_contact_phone or "-",
    ).exclude(id=share.id).exists()
    if already_texted:
        # Texted once already for this trip: don't let repeat taps spam the contact.
        share.sent_to_phone = user.emergency_contact_phone
        share.save(update_fields=["sent_to_phone", "updated_at"])
    elif send_to_contact and user.emergency_contact_phone:
        from accounts.services import _send_sms

        try:
            _send_sms(
                user.emergency_contact_phone,
                f"{user.name or 'Your contact'} is sharing a WolbiRides trip with you. Follow it live: {share_url(share)}",
            )
            share.sent_to_phone = user.emergency_contact_phone
            share.save(update_fields=["sent_to_phone", "updated_at"])
        except Exception:
            logger.exception("Failed to SMS share link for trip %s", trip.id)
    from trips.models import TripEvent

    TripEvent.objects.create(trip=trip, event_type="trip_shared", payload={"share_id": str(share.id)})
    return share


def share_is_live(share):
    """Links stop working when revoked, or 30 minutes after the trip ends."""
    if share.revoked_at:
        return False
    trip = share.trip
    ended_at = trip.completed_at or (trip.updated_at if trip.status in ("cancelled", "no_drivers_found") else None)
    if ended_at and timezone.now() > ended_at + SHARE_GRACE_AFTER_END:
        return False
    return True


def public_trip_view(share):
    """Deliberately minimal: what a worried friend needs, nothing more.
    No passenger phone, no fare, no exact pickup coordinates once the trip is over."""
    from trips.matching import get_driver_location_sync

    trip = share.trip
    data = {
        "status": trip.status,
        "passenger_first_name": (trip.passenger.name or "Your contact").split(" ")[0],
        "pickup_label": trip.pickup_label,
        "destination_label": trip.destination_label,
        "destination_lat": str(trip.destination_lat),
        "destination_lng": str(trip.destination_lng),
        "started_at": trip.started_at,
        "completed_at": trip.completed_at,
        "driver": None,
        "driver_location": None,
        "eta_minutes": None,
    }
    if trip.driver_id:
        driver = trip.driver
        vehicle = driver.vehicles.filter(active=True).first()
        data["driver"] = {
            "first_name": (driver.user.name or "Rider").split(" ")[0],
            "photo": driver.user.profile_photo,
            "plate_number": vehicle.plate_number if vehicle else "",
            "vehicle_type": vehicle.get_vehicle_type_display() if vehicle else "",
        }
        if trip.status in ACTIVE_STATUSES:
            try:
                loc = get_driver_location_sync(str(driver.user_id))
            except Exception:
                logger.warning("Rider location unavailable for share view (Redis down?)")
                loc = None
            if loc:
                data["driver_location"] = {"lat": loc["lat"], "lng": loc["lng"]}
                data["eta_minutes"] = _eta_minutes(trip, loc)
    return data


def _eta_minutes(trip, loc):
    """Rough ETA to the next point (pickup, or destination once on board) at the pilot's
    expected campus speed. Straight-line, so it's labelled 'about' in the UI."""
    from trips.matching import haversine_km

    target = (trip.destination_lat, trip.destination_lng) if trip.status == "in_progress" else (trip.pickup_lat, trip.pickup_lng)
    km = haversine_km(float(loc["lat"]), float(loc["lng"]), float(target[0]), float(target[1]))
    return max(1, round(km / settings.SAFETY_EXPECTED_SPEED_KMH * 60))


# --- Check-ins ----------------------------------------------------------

def expected_trip_minutes(trip):
    """Generous by design: pilot roads, traffic and stops vary a lot, and a
    false alarm costs the passenger a tap, not an escalation."""
    distance = trip.fare_quote.distance_km if hasattr(trip, "fare_quote") and trip.fare_quote else Decimal("3")
    speed = Decimal(str(settings.SAFETY_EXPECTED_SPEED_KMH))
    return float(distance / speed * 60) * settings.SAFETY_OVERDUE_FACTOR + settings.SAFETY_OVERDUE_GRACE_MINUTES


def pending_check_in(trip):
    return trip.check_ins.filter(responded_at__isnull=True, escalated_at__isnull=True).first()


def run_safety_checks(now=None):
    """Called every minute by Celery beat. Returns (created, escalated) counts."""
    from core.models import Notification, notify
    from trips.models import Trip

    now = now or timezone.now()
    created = escalated = 0

    # 1. Prompt passengers on overdue trips (one prompt per trip).
    # Trips that already had a prompt are excluded in the query itself (was one query per trip).
    candidates = Trip.objects.filter(status="in_progress", started_at__isnull=False, check_ins__isnull=True) \
        .select_related("fare_quote", "passenger")
    for trip in candidates:
        if now < trip.started_at + timedelta(minutes=expected_trip_minutes(trip)):
            continue
        SafetyCheckIn.objects.create(trip=trip, reason="trip_overdue")
        notify(trip.passenger, "Are you OK?", "Your trip is taking longer than expected. Tap to let us know.",
               category=Notification.Category.TRIP, link=f"/trip/{trip.id}", channels=("sms",))
        _broadcast_check_in(trip)
        created += 1

    # 2. Escalate prompts nobody answered.
    cutoff = now - timedelta(minutes=settings.SAFETY_CHECKIN_RESPONSE_MINUTES)
    for check_in in SafetyCheckIn.objects.filter(
        responded_at__isnull=True, escalated_at__isnull=True, created_at__lte=cutoff
    ).select_related("trip", "trip__passenger"):
        _escalate(check_in, now)
        escalated += 1
    return created, escalated


def respond_to_check_in(check_in, user, response):
    check_in.response = response
    check_in.responded_at = timezone.now()
    check_in.save(update_fields=["response", "responded_at", "updated_at"])
    if response == SafetyCheckIn.Response.HELP:
        from incidents.services import raise_sos

        raise_sos(check_in.trip, user, note="Passenger answered 'I need help' to an automatic safety check-in.")
    return check_in


def _escalate(check_in, now):
    from accounts.models import User
    from core.models import Notification, notify
    from incidents.models import Incident
    from incidents.services import create_incident

    trip = check_in.trip
    check_in.escalated_at = now
    check_in.save(update_fields=["escalated_at", "updated_at"])
    # P1 so it's prioritised, but no auto-suspend: an unanswered prompt is
    # often just a phone in a bag, not evidence against the driver.
    create_incident(
        reported_by=None,
        severity=Incident.Severity.P1_SERIOUS,
        description=f"Unanswered safety check-in on an overdue trip ({trip.pickup_label} to {trip.destination_label}). "
                    f"Call the passenger ({trip.passenger.phone}).",
        trip=trip,
        suspend_driver=False,
        trigger_source=Incident.TriggerSource.OVERDUE_CHECKIN,
    )
    for staff in User.objects.filter(role__in=["admin", "support"], is_active=True):
        notify(staff, "Unanswered safety check-in", f"Trip {str(trip.id)[:8]} is overdue and the passenger hasn't replied.",
               category=Notification.Category.INCIDENT, link="/incidents", channels=("email", "sms"))
    passenger = trip.passenger
    if passenger.emergency_contact_phone:
        from accounts.services import _send_sms

        try:
            _send_sms(passenger.emergency_contact_phone,
                      f"WolbiRides: {passenger.name or 'your contact'}'s ride is running late and they haven't answered "
                      f"our check-in. Our team is following up. You may want to call them.")
        except Exception:
            logger.exception("Failed to SMS emergency contact for check-in %s", check_in.id)


def _broadcast_check_in(trip):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    from trips.matching import trip_group_name

    try:
        async_to_sync(get_channel_layer().group_send)(
            trip_group_name(str(trip.id)),
            {"type": "trip_update", "data": {"trip_id": str(trip.id), "status": trip.status, "check_in": True}},
        )
    except Exception:
        logger.exception("Failed to broadcast check-in for trip %s", trip.id)
