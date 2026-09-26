from django.utils import timezone

from incidents.models import Incident


def create_incident(reported_by, severity, description, trip=None, suspend_driver=True, **extra):
    """
    PRD Section 4.3 / blueprint WR-06.3: P0/P1 incidents trigger immediate
    escalation, which at MVP scale means auto-suspending the involved
    driver pending human review rather than leaving them dispatchable.
    """
    incident = Incident.objects.create(
        reported_by=reported_by, severity=severity, description=description, trip=trip, **extra
    )
    if suspend_driver and severity in (Incident.Severity.P0_CRITICAL, Incident.Severity.P1_SERIOUS) and trip and trip.driver:
        from drivers.models import Driver
        from drivers.services import take_driver_offline

        Driver.objects.filter(id=trip.driver_id).update(
            verification_status=Driver.VerificationStatus.SUSPENDED, is_online=False
        )
        take_driver_offline(trip.driver, reason="suspended")
    return incident


def resolve_incident(incident):
    incident.status = Incident.Status.RESOLVED
    incident.resolved_at = timezone.now()
    incident.save(update_fields=["status", "resolved_at", "updated_at"])
    return incident


def raise_sos(trip, user, lat=None, lng=None, note=""):
    """
    WR-18: in-trip SOS. Creates a P0 incident, and in the same call:
    - suspends the driver if the *passenger* raised it (a driver raising SOS
      is asking for help, not reporting themselves),
    - notifies every admin/support user in-app,
    - SMSes the reporter's emergency contact if they've set one,
    - logs an audit event on the trip.
    Each side effect is best-effort after the incident row exists: a failed
    SMS must never stop the alert from reaching ops.
    """
    import logging

    from accounts.models import User
    from core.models import Notification, notify
    from trips.models import TripEvent

    logger = logging.getLogger(__name__)

    # Never rate-limited (a real emergency must always get through). A repeat press within
    # 10 minutes on the same trip returns the alert already open instead of re-texting the
    # emergency contact and campus security and opening duplicate incidents.
    from django.utils import timezone

    recent = Incident.objects.filter(
        trip=trip, reported_by=user, trigger_source=Incident.TriggerSource.SOS_BUTTON,
        created_at__gte=timezone.now() - timezone.timedelta(minutes=10),
    ).exclude(status=Incident.Status.RESOLVED).first()
    if recent:
        TripEvent.objects.create(trip=trip, event_type="sos_repeated", payload={"incident_id": str(recent.id)})
        return recent

    raised_by_driver = bool(trip.driver and trip.driver.user_id == user.id)
    who = "Driver" if raised_by_driver else "Passenger"
    where = f" at {lat}, {lng}" if lat is not None and lng is not None else ""
    description = f"SOS raised by {who.lower()} {user.name or user.phone}{where}."
    if note:
        description += f" Note: {note}"

    incident = create_incident(
        reported_by=user,
        severity=Incident.Severity.P0_CRITICAL,
        description=description,
        trip=trip,
        suspend_driver=not raised_by_driver,
        trigger_source=Incident.TriggerSource.SOS_BUTTON,
        location_lat=lat,
        location_lng=lng,
    )
    TripEvent.objects.create(
        trip=trip, event_type="sos_raised",
        payload={"incident_id": str(incident.id), "by": who.lower(), "lat": str(lat) if lat is not None else None,
                 "lng": str(lng) if lng is not None else None},
    )

    for staff in User.objects.filter(role__in=["admin", "support"], is_active=True):
        try:
            notify(staff, f"SOS: {who} needs help", description, category=Notification.Category.INCIDENT,
                   link="/incidents")
        except Exception:
            logger.exception("Failed to notify staff %s of SOS", staff.id)

    # WR-18: campus security (or whoever the zone has on file) hears about it at once.
    zone = trip.zone
    if zone.security_contact_phone:
        from accounts.services import _send_sms

        link = f" https://maps.google.com/?q={lat},{lng}" if lat is not None and lng is not None else ""
        try:
            _send_sms(zone.security_contact_phone,
                      f"WolbiRides SOS ({who.lower()}) in {zone.name}: {trip.pickup_label or 'pickup'} to "
                      f"{trip.destination_label or 'destination'}.{link} Rider {trip.passenger.phone}.")
        except Exception:
            logger.exception("Failed to SMS zone security contact for SOS %s", incident.id)

    if user.emergency_contact_phone:
        from accounts.services import _send_sms

        map_link = f" Location: https://maps.google.com/?q={lat},{lng}" if lat is not None and lng is not None else ""
        message = (
            f"WolbiRides safety alert: {user.name or 'Your contact'} pressed SOS during a ride "
            f"({trip.pickup_label or 'pickup'} to {trip.destination_label or 'destination'}).{map_link} "
            f"Our team has been alerted."
        )
        try:
            _send_sms(user.emergency_contact_phone, message)
        except Exception:
            logger.exception("Failed to SMS emergency contact for SOS %s", incident.id)

    return incident


def post_trip_checkin(trip, user, response, details=""):
    """
    WR-18: "Did anything feel off?" after a completed trip. Deliberately separate
    from ratings. "Something felt off" opens a P2 incident for ops to follow up
    (no automatic suspension from a single post-trip answer; SOS is the path for
    danger in the moment).
    """
    from trips.models import TripEvent

    TripEvent.objects.create(trip=trip, event_type="post_trip_checkin",
                             payload={"by": "driver" if trip.driver and trip.driver.user_id == user.id else "passenger",
                                      "response": response})
    if response != "something_off":
        return None
    who = "driver" if trip.driver and trip.driver.user_id == user.id else "passenger"
    return create_incident(
        reported_by=user,
        severity=Incident.Severity.P2_SERVICE,
        description=f"Post-trip check-in from the {who}: something felt off. {details}".strip(),
        trip=trip,
        suspend_driver=False,
        trigger_source=Incident.TriggerSource.POST_TRIP_CHECKIN,
    )
