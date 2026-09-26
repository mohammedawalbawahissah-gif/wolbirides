"""
Trip lifecycle orchestration (PRD Section 6.2).

Kept separate from views/serializers so the same logic can be triggered
from a REST endpoint (ride request), a websocket message (driver accept),
or a background task (dispatch timeout cascade) without duplicating the
state machine in three places.
"""

import logging

import secrets
from decimal import Decimal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from trips.matching import haversine_km, scored_candidate_drivers, trip_group_name
from trips.models import DeliveryDetail, FareQuote, Trip, TripEvent, TripPreference


class TripRequestError(ValueError):
    """A trip request that can't go ahead as asked, with rider-facing text."""


class TripFlowError(ValueError):
    """An action that doesn't fit this trip's type or state (e.g. /start on a delivery)."""


class DeliveryCodeError(ValueError):
    pass


class OfferNotValid(ValueError):
    """Raised when a driver acts on an offer that isn't (or is no longer) theirs."""


DISPATCH_OFFER_TIMEOUT_SECONDS = 18
DELIVERIES_PER_HOUR = 5
ACTIVE_STATUSES = ("matched", "driver_arriving", "in_progress")

# WR-19 soft preferences (ranking only) and the driver capability each maps to.
SOFT_PREFERENCES = {
    "quiet_ride": "offers_quiet_ride",
    "needs_luggage_space": "has_luggage_space",
    "needs_accessibility_help": "accessibility_trained",
}
GENDER_CHOICES = ("", "female", "male")


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


def quote_fare(zone, distance_km, trip_type="ride"):
    """PRD Section 5 FareQuote. Placeholder linear model until WR-02 field research
    replaces base_fare/per_km_rate. WR-23 deliveries add a flat surcharge."""
    from django.conf import settings

    per_km_charge = (Decimal(distance_km) * zone.per_km_rate).quantize(Decimal("0.01"))
    surcharge = Decimal(str(settings.DELIVERY_SURCHARGE)) if trip_type == Trip.Kind.DELIVERY else Decimal("0.00")
    return {
        "distance_km": distance_km,
        "base_fare": zone.base_fare,
        "per_km_charge": per_km_charge,
        "surcharge": surcharge,
        "total": zone.base_fare + per_km_charge + surcharge,
    }


def _resolve_preferences(passenger, per_trip):
    """Account defaults (TripPreference), overridden by anything set for this trip."""
    saved = TripPreference.objects.filter(user=passenger).first()
    prefs = saved.as_dict() if saved else {}
    for key, value in (per_trip or {}).items():
        if key == "preferred_driver_gender":
            prefs[key] = value if value in GENDER_CHOICES else ""
        elif key in SOFT_PREFERENCES or key == "prefer_previous_drivers":
            prefs[key] = bool(value)
    return {k: v for k, v in prefs.items() if v}


def request_trip(passenger, zone, pickup, destination, client_reported_distance_km=None, options=None):
    """
    PRD Section 6.2 step 1, extended by the Growth PRD.

    Distance is always computed server-side, never trusted from the client.
    `client_reported_distance_km` is only compared for anti-fraud logging.

    `options` (all optional):
      trip_type "ride" | "delivery" (legacy alias: kind)                        WR-23
      recipient_name, recipient_phone, package_description, package_size       WR-23
      shareable (legacy alias: is_pool)                                         WR-17
      preferences {preferred_driver_gender, prefer_previous_drivers, ...}       WR-19
      payment_method None (auto) | cash | momo | organization | voucher | bundle
      organization_id / voucher_id (WR-21), bundle_id (WR-22), promo_code (WR-24)

    With no payment_method, an active ride bundle pays automatically, oldest
    first, when it covers the fare (WR-22); otherwise the rider pays per trip.
    Runs in one transaction, so a rejected option leaves nothing behind.
    """
    options = options or {}
    trip_type = options.get("trip_type") or options.get("kind") or Trip.Kind.RIDE
    if trip_type not in Trip.Kind.values:
        raise TripRequestError("trip_type must be 'ride' or 'delivery'.")
    payment_method = options.get("payment_method") or None
    shareable = bool(options.get("shareable", options.get("is_pool"))) and trip_type == Trip.Kind.RIDE

    if trip_type == Trip.Kind.DELIVERY:
        missing = [f for f in ("recipient_name", "recipient_phone", "package_description") if not options.get(f)]
        if missing:
            raise TripRequestError(f"Deliveries need: {', '.join(missing)}.")
        # Each delivery texts the recipient, whose number the sender chooses. Cap it so the
        # booking form can't be used to spam arbitrary phones (bookings can be cancelled free).
        recent = Trip.objects.filter(passenger=passenger, trip_type=Trip.Kind.DELIVERY,
                                     requested_at__gte=timezone.now() - timezone.timedelta(hours=1)).count()
        if recent >= DELIVERIES_PER_HOUR:
            raise TripRequestError("You've booked a lot of deliveries in the last hour. Try again a little later.")
    prepaid_methods = (Trip.PaymentMethod.ORGANIZATION, Trip.PaymentMethod.VOUCHER, Trip.PaymentMethod.BUNDLE)
    if options.get("promo_code") and payment_method in prepaid_methods:
        raise TripRequestError("Promo codes can't be combined with organization billing, vouchers or bundles.")

    preferences = _resolve_preferences(passenger, options.get("preferences"))

    with transaction.atomic():
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
            trip_type=trip_type,
            shareable=shareable,
            payment_method=payment_method or Trip.PaymentMethod.CASH,
            preferences=preferences,
        )
        distance_km = round(
            haversine_km(float(pickup["lat"]), float(pickup["lng"]),
                         float(destination["lat"]), float(destination["lng"])),
            2,
        )
        fare = quote_fare(zone, distance_km, trip_type)

        discount, reason, promo = Decimal("0.00"), "", None
        if options.get("promo_code"):
            from partners.services import compute_discount, find_promo

            promo = find_promo(options["promo_code"], lock=True)
            discount = compute_discount(promo, passenger, fare["total"],
                                        destination=(destination["lat"], destination["lng"]))
            reason = f"Promo {promo.code}"
        total = fare["total"] - discount
        FareQuote.objects.create(
            trip=trip, distance_km=fare["distance_km"], base_fare=fare["base_fare"],
            per_km_charge=fare["per_km_charge"], surcharge=fare["surcharge"], discount=discount,
            discount_reason=reason, total=total, expires_at=timezone.now() + timezone.timedelta(minutes=5),
        )
        if promo:
            from partners.models import PromoRedemption

            PromoRedemption.objects.create(promo=promo, user=passenger, trip=trip, amount=discount)

        _apply_payment_source(trip, passenger, payment_method, options, total, promo_used=bool(promo))

        if trip_type == Trip.Kind.DELIVERY:
            DeliveryDetail.objects.create(
                trip=trip,
                recipient_name=options["recipient_name"].strip(),
                recipient_phone=_normalize(options["recipient_phone"]),
                package_description=options["package_description"].strip(),
                package_size=options.get("package_size") or DeliveryDetail.PackageSize.SMALL,
                pickup_code=f"{secrets.randbelow(10000):04d}",
                dropoff_code=f"{secrets.randbelow(10000):04d}",
            )

        if client_reported_distance_km is not None:
            claimed = float(client_reported_distance_km)
            # >25% off is well outside GPS noise: flag for review, never block the trip.
            if distance_km > 0 and abs(claimed - distance_km) / distance_km > 0.25:
                _log_event(trip, "distance_mismatch",
                           {"client_reported_km": claimed, "server_computed_km": distance_km})

        _log_event(trip, "requested", {
            "fare_total": str(total), "trip_type": trip_type, "payment_method": trip.payment_method,
            "shareable": shareable,
        })

    if trip_type == Trip.Kind.DELIVERY:
        transaction.on_commit(lambda: _notify_delivery_recipient(trip))
    return trip


def _apply_payment_source(trip, passenger, payment_method, options, total, promo_used):
    if payment_method == Trip.PaymentMethod.ORGANIZATION:
        from organizations.services import check_can_bill

        trip.organization = check_can_bill(passenger, options.get("organization_id"), total)
        trip.save(update_fields=["organization", "updated_at"])
    elif payment_method == Trip.PaymentMethod.VOUCHER:
        from organizations.services import reserve_voucher

        trip.voucher = reserve_voucher(passenger, options.get("voucher_id"), trip, total)
        trip.organization = trip.voucher.organization
        trip.save(update_fields=["voucher", "organization", "updated_at"])
    elif payment_method == Trip.PaymentMethod.BUNDLE:
        from bundles.services import reserve_ride

        trip.bundle = reserve_ride(passenger, options.get("bundle_id"), trip, total)
        trip.save(update_fields=["bundle", "updated_at"])
    elif payment_method is None and not promo_used:
        # WR-22: bundle rides are used automatically, oldest bundle first.
        from bundles.services import auto_reserve

        bundle = auto_reserve(passenger, trip, total)
        if bundle:
            trip.bundle = bundle
            trip.payment_method = Trip.PaymentMethod.BUNDLE
            trip.save(update_fields=["bundle", "payment_method", "updated_at"])


def _normalize(phone):
    from accounts.services import normalize_phone

    return normalize_phone(phone) if phone else ""


def _notify_delivery_recipient(trip):
    """WR-23: the recipient gets the drop-off code plus a live tracking link."""
    import logging

    from accounts.services import _send_sms
    from safety.models import TripShare
    from safety.services import share_url

    delivery = trip.delivery
    share = TripShare.objects.create(trip=trip, created_by=trip.passenger, sent_to_phone=delivery.recipient_phone)
    sender = trip.passenger.name or "Someone"
    try:
        _send_sms(
            delivery.recipient_phone,
            f"{sender} is sending you a package with WolbiRides. Give the driver code {delivery.dropoff_code} "
            f"only when you receive it. Track it: {share_url(share)}",
        )
    except Exception:
        logging.getLogger(__name__).exception("Failed to SMS delivery recipient for trip %s", trip.id)


# --- Dispatch -------------------------------------------------------------------------

def start_dispatch_cascade(trip):
    """WR-17: a shareable request first tries to share (join a driver already heading
    out, or pair with another rider still searching); otherwise normal dispatch."""
    if trip.shareable and trip.status == Trip.Status.REQUESTED:
        from trips import pooling

        outcome = pooling.try_pool(trip)
        if outcome and outcome[0] == "joined":
            return str(outcome[1].user_id)
        if outcome and outcome[0] == "waiting":
            return None
    return _dispatch(trip)


def _dispatch(trip):
    """
    PRD Section 6.2 steps 2-4: rank candidates, offer to the first, schedule a
    timeout. Returns the offered driver's user id, or None.
    """
    trip.status = Trip.Status.MATCHING
    trip.save(update_fields=["status", "updated_at"])
    _log_event(trip, "dispatch_started")

    already_offered = set(trip.events.filter(event_type="offered_to_driver").values_list(
        "payload__driver_id", flat=True
    ))
    scored = async_to_sync(scored_candidate_drivers)(
        str(trip.zone_id), trip.pickup_lat, trip.pickup_lng, exclude_driver_ids=already_offered
    )
    candidates, meta = order_candidates(trip, scored)

    if not candidates and meta.get("blocked_by_preference"):
        _handle_preference_block(trip)
        return None
    if not candidates:
        trip.status = Trip.Status.NO_DRIVERS_FOUND
        trip.save(update_fields=["status", "updated_at"])
        _log_event(trip, "no_drivers_found")
        _broadcast_trip_update(trip)
        from trips import pooling

        pooling.on_trip_ended(trip)
        return None

    next_driver_id = candidates[0]
    _offer_to_driver(trip, next_driver_id, meta)
    return next_driver_id


def order_candidates(trip, scored):
    """
    Returns (driver_user_ids_in_offer_order, meta).

    - Drivers already heading to or carrying a rider are skipped (shared riders
      reach them through pooling instead).
    - Deliveries only go to drivers who opted in (WR-23).
    - WR-19 driver-gender preference: only matching drivers, until the rider
      says otherwise. If none is available, meta["blocked_by_preference"] is
      set and the rider is asked; nobody is silently reassigned.
    - Drivers within FAIR_QUEUE_BAND_KM of the nearest count as equally close
      (the ETA cap). Inside that band, soft preferences and "drivers I've ridden
      with" rank first; otherwise it's nearest-first.
    - WR-20 fairness floor: on FAIR_QUEUE_SHARE of dispatches, the in-band
      driver with the fewest trips in the last 7 days goes first instead. The
      extra distance this costs is logged on the offer so it can be measured.
    """
    from django.conf import settings
    from django.db.models import Count, Q
    from drivers.models import Driver

    meta = {"blocked_by_preference": False, "fair_queue": False, "nearest_km": None, "distances": {}}
    if not scored:
        return [], meta
    ids = [driver_id for _, driver_id in scored]
    busy = set(str(u) for u in Trip.objects.filter(
        driver__user_id__in=ids, status__in=ACTIVE_STATUSES,
    ).values_list("driver__user_id", flat=True))
    week_ago = timezone.now() - timezone.timedelta(days=7)
    drivers = {
        str(d.user_id): d
        # Presence comes from Redis, eligibility from the database: a suspended or
        # offline driver whose app is still pinging must never be offered a ride.
        for d in Driver.objects.filter(
            user_id__in=ids, verification_status=Driver.VerificationStatus.VERIFIED, is_online=True,
        ).annotate(
            trips_7d=Count("trips_as_driver", filter=Q(
                trips_as_driver__status=Trip.Status.COMPLETED, trips_as_driver__completed_at__gte=week_ago)),
        )
    }
    scored = [(dist, i) for dist, i in scored if i not in busy and i in drivers]
    if trip.trip_type == Trip.Kind.DELIVERY:
        scored = [(dist, i) for dist, i in scored if drivers[i].accepts_deliveries]

    prefs = trip.preferences or {}
    wanted_gender = prefs.get("preferred_driver_gender")
    if wanted_gender and trip.preference_status != Trip.PreferenceStatus.RELAXED:
        matching = [(dist, i) for dist, i in scored if drivers[i].gender == wanted_gender]
        if scored and not matching:
            meta["blocked_by_preference"] = True
        scored = matching
    if not scored:
        return [], meta

    soft = [k for k in SOFT_PREFERENCES if prefs.get(k)]
    previous = set()
    if prefs.get("prefer_previous_drivers"):
        previous = set(str(u) for u in Trip.objects.filter(
            passenger_id=trip.passenger_id, status=Trip.Status.COMPLETED,
        ).values_list("driver__user_id", flat=True))

    def pref_score(i):
        d = drivers[i]
        return sum(1 for k in soft if getattr(d, SOFT_PREFERENCES[k])) + (1 if i in previous else 0)

    nearest = scored[0][0]
    band_limit = nearest + settings.FAIR_QUEUE_BAND_KM
    in_band = [(dist, i) for dist, i in scored if dist <= band_limit]
    beyond = [(dist, i) for dist, i in scored if dist > band_limit]

    if len(in_band) > 1 and _fairness_draw() < settings.FAIR_QUEUE_SHARE:
        meta["fair_queue"] = True
        in_band.sort(key=lambda t: (-pref_score(t[1]), drivers[t[1]].trips_7d, t[0]))
    else:
        in_band.sort(key=lambda t: (-pref_score(t[1]), t[0]))
    meta["nearest_km"] = nearest
    meta["distances"] = {i: dist for dist, i in scored}
    return [i for _, i in in_band] + [i for _, i in beyond], meta


_system_random = secrets.SystemRandom()


def _fairness_draw():
    """0..1, deciding whether this dispatch uses the WR-20 fairness floor. Not security-
    sensitive, but the OS random source costs nothing."""
    return _system_random.random()


def _handle_preference_block(trip):
    """WR-19: no driver matching the rider's preference is free. Ask the rider,
    or (if they already chose to keep waiting) try again shortly."""
    from core.models import notify
    from trips.tasks import retry_preference_dispatch

    if trip.preference_status == Trip.PreferenceStatus.KEEP_WAITING:
        attempts = trip.events.filter(event_type="preference_retry").count()
        if attempts < 10:
            _log_event(trip, "preference_retry", {"attempt": attempts + 1})
            retry_preference_dispatch.apply_async(args=[str(trip.id)], countdown=30)
            return
    trip.preference_status = Trip.PreferenceStatus.AWAITING_RIDER
    trip.save(update_fields=["preference_status", "updated_at"])
    _log_event(trip, "preference_unavailable")
    _broadcast_trip_update(trip)
    notify(trip.passenger, "No matching driver free right now",
           "Take the next available driver, or keep waiting for one that matches your preference.",
           category="trip", link=f"/trip/{trip.id}")


def preference_decision(trip, decision):
    """Rider's answer when their preferred driver isn't available: 'any_driver' or 'keep_waiting'."""
    if trip.status != Trip.Status.MATCHING or trip.preference_status not in (
        Trip.PreferenceStatus.AWAITING_RIDER, Trip.PreferenceStatus.KEEP_WAITING,
    ):
        raise TripFlowError("There's no decision waiting on this trip.")
    if decision == "any_driver":
        trip.preference_status = Trip.PreferenceStatus.RELAXED
        trip.save(update_fields=["preference_status", "updated_at"])
        _log_event(trip, "preference_relaxed")
        return _dispatch(trip)
    if decision == "keep_waiting":
        from trips.tasks import retry_preference_dispatch

        trip.preference_status = Trip.PreferenceStatus.KEEP_WAITING
        trip.save(update_fields=["preference_status", "updated_at"])
        _log_event(trip, "preference_keep_waiting")
        retry_preference_dispatch.apply_async(args=[str(trip.id)], countdown=30)
        _broadcast_trip_update(trip)
        return None
    raise TripFlowError("decision must be 'any_driver' or 'keep_waiting'.")


def _offer_to_driver(trip, driver_id, meta=None):
    """Drivers see the job, never the rider's preferences or why they were chosen (WR-19)."""
    from trips import pooling

    payload = {
        "trip_id": str(trip.id),
        "pickup_label": trip.pickup_label,
        "destination_label": trip.destination_label,
        "fare_estimate": str(trip.fare_quote.total),
        "trip_type": trip.trip_type,
        "kind": trip.trip_type,  # legacy alias for older app builds
        "timeout_seconds": DISPATCH_OFFER_TIMEOUT_SECONDS,
    }
    if trip.trip_type == Trip.Kind.DELIVERY and hasattr(trip, "delivery"):
        payload["package_description"] = trip.delivery.package_description
        payload["package_size"] = trip.delivery.package_size
    legs = pooling.offer_legs(trip)
    if legs:
        payload["pool_legs"] = legs
        payload["fare_estimate"] = str(sum(Decimal(l["fare"]) for l in legs if l["type"] == "pickup"))

    async_to_sync(get_channel_layer().group_send)(
        f"driver.{driver_id}", {"type": "ride_request", "trip": payload},
    )
    meta = meta or {}
    event = {"driver_id": driver_id}
    if meta.get("nearest_km") is not None and driver_id in meta.get("distances", {}):
        event["extra_km"] = round(meta["distances"][driver_id] - meta["nearest_km"], 3)
        event["fair_queue"] = meta.get("fair_queue", False)
    _log_event(trip, "offered_to_driver", event)

    from trips.tasks import check_dispatch_offer_timeout

    check_dispatch_offer_timeout.apply_async(
        args=[str(trip.id), driver_id], countdown=DISPATCH_OFFER_TIMEOUT_SECONDS
    )


def current_offered_driver_id(trip):
    """User id of the driver the trip is currently offered to, or None.

    Offers are keyed by the driver's *user* id everywhere in dispatch
    (Redis online set, websocket group, offered_to_driver events), so this
    is the value to compare against — never the Driver row's own pk.
    """
    event = trip.events.filter(event_type="offered_to_driver").order_by("-created_at").first()
    return (event.payload or {}).get("driver_id") if event else None


def accept_trip(trip, driver):
    """Driver accepted within the offer window.

    Locked and checked so only the driver currently offered the trip can
    accept, they must still be verified, and two accepts can't both win.
    Riders waiting on this trip's shared group are matched to the same driver.
    """
    from drivers.models import Driver
    from trips import pooling

    with transaction.atomic():
        trip = Trip.objects.select_for_update().get(id=trip.id)
        if trip.status != Trip.Status.MATCHING:
            raise OfferNotValid(f"Trip {trip.id} is not awaiting match (status={trip.status})")
        if current_offered_driver_id(trip) != str(driver.user_id):
            raise OfferNotValid("This trip isn't currently offered to you.")
        if driver.verification_status != Driver.VerificationStatus.VERIFIED:
            raise OfferNotValid("Only verified drivers can accept trips.")
        trip.driver = driver
        trip.status = Trip.Status.MATCHED
        trip.matched_at = timezone.now()
        trip.save(update_fields=["driver", "status", "matched_at", "updated_at"])
        _log_event(trip, "matched", {"driver_id": str(driver.id), "driver_user_id": str(driver.user_id)})
        joined = pooling.on_accept(trip, driver)

    _broadcast_trip_update(trip)
    try:
        async_to_sync(get_channel_layer().group_send)(
            f"driver.{driver.user_id}", {"type": "tracking_mode", "mode": "active"}
        )
    except Exception:
        # Not critical: the driver's socket re-checks its tracking mode within 30s anyway.
        logging.getLogger(__name__).warning("Couldn't push tracking mode to driver %s", driver.user_id)
    from core.models import notify

    notify(trip.passenger, "Driver assigned", f"{driver.user.name or 'Your driver'} is on the way.",
           category="trip", link=f"/trip/{trip.id}")
    for other in joined:
        _broadcast_trip_update(other)
        notify(other.passenger, "Shared ride matched", f"{driver.user.name or 'Your driver'} is on the way.",
               category="trip", link=f"/trip/{other.id}")
    return trip


def decline_or_timeout(trip, driver_user_id):
    """Driver declined, or their offer expired: cascade to the next candidate.

    A no-op unless the trip is still MATCHING *and* still offered to this driver.
    """
    with transaction.atomic():
        trip = Trip.objects.select_for_update().get(id=trip.id)
        if trip.status != Trip.Status.MATCHING or current_offered_driver_id(trip) != str(driver_user_id):
            return None
        _log_event(trip, "declined_or_timed_out", {"driver_id": str(driver_user_id)})
    return _dispatch(trip)


# --- Trip lifecycle -------------------------------------------------------------------

def _begin(trip):
    trip.status = Trip.Status.IN_PROGRESS
    trip.started_at = timezone.now()
    trip.save(update_fields=["status", "started_at", "updated_at"])
    _log_event(trip, "started")
    if trip.pool_group_id:
        # First pickup done: nobody else joins this group (no surprise detours).
        from trips.models import PoolGroup

        PoolGroup.objects.filter(id=trip.pool_group_id).update(status=PoolGroup.Status.CLOSED)
    _broadcast_trip_update(trip)
    return trip


def start_trip(trip):
    if trip.trip_type == Trip.Kind.DELIVERY:
        raise TripFlowError("Deliveries start with a confirmed pickup (confirm-pickup).")
    if trip.status not in (Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING):
        raise TripFlowError("This trip can't be started now.")
    return _begin(trip)


def confirm_pickup(trip, code="", photo_url=""):
    """WR-23: the driver confirms they collected the package, with the sender's code or a photo."""
    if trip.trip_type != Trip.Kind.DELIVERY:
        raise TripFlowError("Only deliveries have a pickup confirmation.")
    if trip.status not in (Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING):
        raise TripFlowError("This delivery can't be picked up now.")
    delivery = trip.delivery
    code = (code or "").strip()
    if code and code != delivery.pickup_code:
        raise DeliveryCodeError("That pickup code doesn't match. Ask the sender for the code in their app.")
    if not code and not photo_url:
        raise DeliveryCodeError("Enter the sender's pickup code, or add a photo of the package.")
    delivery.picked_up_at = timezone.now()
    delivery.pickup_confirmation_photo = photo_url or ""
    delivery.save(update_fields=["picked_up_at", "pickup_confirmation_photo", "updated_at"])
    _log_event(trip, "delivery_picked_up", {"by": "code" if code else "photo"})
    return _begin(trip)


# WR-16: proximity-based "driver arriving" push. DRIVER_ARRIVING has existed
# in Trip.Status since the original model but nothing ever transitioned a
# trip into it — this is the missing piece, triggered from the driver's own
# location pings rather than a separate polling job.
DRIVER_ARRIVING_RADIUS_KM = 0.3  # ~300m — close enough to be a useful "get ready" signal


def mark_driver_arriving(trip):
    if trip.status != Trip.Status.MATCHED:
        return trip
    trip.status = Trip.Status.DRIVER_ARRIVING
    trip.save(update_fields=["status", "updated_at"])
    _log_event(trip, "driver_arriving")
    _broadcast_trip_update(trip)

    from core.models import notify

    notify(trip.passenger, "Your driver is close by", "Head to your pickup point now.", category="trip", link=f"/trip/{trip.id}")
    return trip


def check_and_mark_driver_arriving(driver_user_id, lat, lng):
    """Called from location pings. A driver can have two waiting riders on a shared ride.
    Returns how many trips are still waiting for this driver's pickup, so the
    socket can skip the check for a while when there are none."""
    if lat is None or lng is None:
        return 0
    waiting = list(Trip.objects.filter(driver__user_id=driver_user_id, status=Trip.Status.MATCHED))
    for trip in waiting:
        if haversine_km(float(lat), float(lng), float(trip.pickup_lat), float(trip.pickup_lng)) <= DRIVER_ARRIVING_RADIUS_KM:
            mark_driver_arriving(trip)
    return len(waiting)


def _finish(trip, fare_final=None):
    trip.status = Trip.Status.COMPLETED
    trip.completed_at = timezone.now()
    trip.fare_final = fare_final or trip.pool_seat_fare or trip.fare_quote.total
    trip.save(update_fields=["status", "completed_at", "fare_final", "updated_at"])
    _log_event(trip, "completed", {"fare_final": str(trip.fare_final)})
    _settle_non_cash_payment(trip)
    _broadcast_trip_update(trip)

    from core.models import notify

    notify(trip.passenger, "Trip complete", f"GH₵{trip.fare_final}. Thanks for riding with us.",
           category="trip", link=f"/trip/{trip.id}")
    if trip.driver:
        notify(trip.driver.user, "Trip complete", f"GH₵{trip.fare_final} added to your earnings.",
               category="trip", link="/earnings")
    return trip


def complete_trip(trip, fare_final=None, delivery_code=None):
    if trip.trip_type == Trip.Kind.DELIVERY:
        # Older app builds still call /complete with the code; treat it as confirm-dropoff.
        return confirm_dropoff(trip, delivery_code)
    if trip.status != Trip.Status.IN_PROGRESS:
        raise TripFlowError("Only a trip in progress can be completed.")
    return _finish(trip, fare_final)


def confirm_dropoff(trip, code, photo_url=""):
    """WR-23: the delivery only completes with the recipient's code (a photo is extra evidence, not a substitute)."""
    if trip.trip_type != Trip.Kind.DELIVERY:
        raise TripFlowError("Only deliveries have a drop-off confirmation.")
    if trip.status != Trip.Status.IN_PROGRESS:
        raise TripFlowError("Confirm pickup before drop-off.")
    delivery = trip.delivery
    if (code or "").strip() != delivery.dropoff_code:
        raise DeliveryCodeError("That code doesn't match. Ask the recipient for the 4-digit code from their SMS.")
    if photo_url:
        delivery.dropoff_confirmation_photo = photo_url
        delivery.save(update_fields=["dropoff_confirmation_photo", "updated_at"])
    _log_event(trip, "delivery_dropped_off")
    return _finish(trip)


def cancel_trip(trip, cancelled_by, reason=""):
    trip.status = Trip.Status.CANCELLED
    trip.cancelled_by = cancelled_by
    trip.cancel_reason = reason
    trip.save(update_fields=["status", "cancelled_by", "cancel_reason", "updated_at"])
    _log_event(trip, "cancelled", {"by": cancelled_by, "reason": reason})
    _release_trip_holds(trip)
    _broadcast_trip_update(trip)
    from trips import pooling

    pooling.on_trip_ended(trip)

    from core.models import notify

    if cancelled_by != "passenger":
        notify(trip.passenger, "Trip cancelled", reason or "Your trip was cancelled.", category="trip", link="/")
    if trip.driver and cancelled_by != "driver":
        notify(trip.driver.user, "Trip cancelled", reason or "The trip was cancelled.", category="trip", link="/")
    return trip


# --- Settlement -----------------------------------------------------------------------

def _settle_non_cash_payment(trip):
    """Organization, voucher and bundle trips settle on completion, so they reach
    the driver's weekly payout like MoMo trips (never collected in cash)."""
    from payments.models import Payment

    FS = Payment.FundingSource
    if trip.payment_method == Trip.PaymentMethod.BUNDLE:
        from bundles.services import settle_for_trip

        settle_for_trip(trip, completed=True)
        funding = FS.RIDE_BUNDLE
    elif trip.payment_method == Trip.PaymentMethod.VOUCHER:
        from organizations.services import settle_voucher

        settle_voucher(trip, completed=True)
        funding = FS.ORGANIZATION_VOUCHER
    elif trip.payment_method == Trip.PaymentMethod.ORGANIZATION:
        funding = FS.ORGANIZATION_ACCOUNT
    else:
        return
    if trip.organization_id:
        from organizations.services import charge_prepaid_balance

        charge_prepaid_balance(trip)
    Payment.objects.update_or_create(
        trip=trip,
        defaults={"method": trip.payment_method, "funding_source": funding, "amount": trip.fare_final,
                  "status": Payment.Status.SUCCESS},
    )


def _release_trip_holds(trip):
    if trip.payment_method == Trip.PaymentMethod.BUNDLE:
        from bundles.services import settle_for_trip

        settle_for_trip(trip, completed=False)
    if trip.payment_method == Trip.PaymentMethod.VOUCHER:
        from organizations.services import settle_voucher

        settle_voucher(trip, completed=False)
    from partners.services import void_for_trip

    void_for_trip(trip)


def trip_list_queryset(user=None):
    """
    Everything TripSerializer reads, fetched up front: fare quote, driver, user,
    active vehicle, organization, delivery, shared-ride group, and (for the viewer)
    whether they've rated each trip. Turns ~5 queries per listed trip into ~3 total.
    """
    from django.db.models import Exists, OuterRef, Prefetch

    from drivers.models import Vehicle
    from trips.models import Rating

    qs = Trip.objects.select_related(
        "fare_quote", "driver__user", "passenger", "organization", "delivery", "pool_group",
    ).prefetch_related(
        Prefetch("driver__vehicles", queryset=Vehicle.objects.filter(active=True), to_attr="active_vehicles"),
    )
    if user is not None and getattr(user, "is_authenticated", False):
        qs = qs.annotate(rated_by_me_annotated=Exists(Rating.objects.filter(trip=OuterRef("pk"), rater=user)))
    return qs


HISTORY_PAGE_SIZE = 50


def history_page(qs, request):
    """
    One page of trip history, newest first. `?before=<requested_at of the last trip shown>`
    fetches the next (older) page; the response is still a plain list, so the apps show
    "Load older trips" while a page comes back full.
    """
    from django.utils.dateparse import parse_datetime

    before = parse_datetime(request.query_params.get("before", "") or "")
    if before:
        qs = qs.filter(requested_at__lt=before)
    return qs.order_by("-requested_at")[:HISTORY_PAGE_SIZE]


def user_can_access_trip(user, trip):
    if user.role == "admin":
        return True
    if trip.passenger_id == user.id:
        return True
    if trip.driver and trip.driver.user_id == user.id:
        return True
    return False
