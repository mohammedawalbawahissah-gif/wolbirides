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
from trips.models import DeliveryDetail, FareQuote, Trip, TripEvent, TripPreference, Vendor


class TripRequestError(ValueError):
    """A trip request that can't go ahead as asked, with passenger-facing text."""


class TripFlowError(ValueError):
    """An action that doesn't fit this trip's type or state (e.g. /start on a delivery)."""


class DeliveryCodeError(ValueError):
    pass


class AssignmentError(ValueError):
    """Ops tried to hand a delivery to someone who can't take it (wrong state, busy, unverified...)."""


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


def quote_fare(zone, distance_km, trip_type="ride", delivery_subtype=None, package_size=None):
    """PRD Section 5 FareQuote. Placeholder linear model until WR-02 field research
    replaces base_fare/per_km_rate. WR-23/25: parcels surcharge by package size; errands
    and vendor orders (no package to size) take a flat task surcharge instead."""
    from django.conf import settings

    per_km_charge = (Decimal(distance_km) * zone.per_km_rate).quantize(Decimal("0.01"))
    surcharge = Decimal("0.00")
    if trip_type == Trip.Kind.DELIVERY:
        if delivery_subtype in (None, DeliveryDetail.Subtype.PARCEL):
            size = package_size or DeliveryDetail.PackageSize.SMALL
            surcharge = Decimal(str(settings.DELIVERY_SURCHARGE_BY_SIZE.get(
                size, settings.DELIVERY_SURCHARGE_BY_SIZE["small"]
            )))
        else:
            surcharge = Decimal(str(settings.DELIVERY_TASK_SURCHARGE))
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
      delivery_subtype "parcel" (default) | "errand" | "vendor_order"           WR-25
      recipient_name, recipient_phone, package_description, package_size        WR-23
        — required for "parcel"; not required for "errand"/"vendor_order"       WR-25
      task_description, spend_limit                                             WR-25
        — what the courier buys/collects, and how much they can spend           WR-25
      vendor_id (existing Vendor) or vendor_name/vendor_location (new one)       WR-25
        — "vendor_order" only; a new name+location creates a Vendor row         WR-25
      shareable (legacy alias: is_pool)                                         WR-17
      preferences {preferred_driver_gender, prefer_previous_drivers, ...}       WR-19
      payment_method None (auto) | cash | momo | organization | voucher | bundle
      organization_id / voucher_id (WR-21), bundle_id (WR-22), promo_code (WR-24)

    With no payment_method, an active ride bundle pays automatically, oldest
    first, when it covers the fare (WR-22); otherwise the passenger pays per trip.
    Runs in one transaction, so a rejected option leaves nothing behind.
    """
    options = options or {}
    trip_type = options.get("trip_type") or options.get("kind") or Trip.Kind.RIDE
    if trip_type not in Trip.Kind.values:
        raise TripRequestError("trip_type must be 'ride' or 'delivery'.")
    payment_method = options.get("payment_method") or None
    shareable = bool(options.get("shareable", options.get("is_pool"))) and trip_type == Trip.Kind.RIDE

    delivery_subtype = options.get("delivery_subtype") or DeliveryDetail.Subtype.PARCEL
    if delivery_subtype not in DeliveryDetail.Subtype.values:
        raise TripRequestError("delivery_subtype must be 'parcel', 'errand', or 'vendor_order'.")

    vendor = None
    parties = {}
    if trip_type == Trip.Kind.DELIVERY:
        if delivery_subtype == DeliveryDetail.Subtype.ERRAND:
            if not options.get("task_description"):
                raise TripRequestError("Tell the courier what to buy or collect.")
        elif delivery_subtype == DeliveryDetail.Subtype.VENDOR_ORDER:
            if not options.get("task_description"):
                raise TripRequestError("Tell the courier what to order.")
            vendor = _resolve_vendor(options)
        elif not options.get("package_description"):
            raise TripRequestError("Deliveries need: package_description.")
        parties = _resolve_delivery_parties(passenger, delivery_subtype, options, vendor)
        # Each delivery can text up to two third parties (sender and recipient), whose numbers the
        # booker chooses. Cap it so the booking form can't be used to spam arbitrary phones
        # (bookings can be cancelled free).
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
        fare = quote_fare(zone, distance_km, trip_type, delivery_subtype, options.get("package_size"))

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
                delivery_subtype=delivery_subtype,
                sender_name=parties["sender_name"], sender_phone=parties["sender_phone"],
                recipient_name=parties["recipient_name"], recipient_phone=parties["recipient_phone"],
                package_description=(options.get("package_description") or "").strip(),
                package_size=options.get("package_size") or DeliveryDetail.PackageSize.SMALL,
                task_description=(options.get("task_description") or "").strip(),
                spend_limit=options.get("spend_limit") or None,
                vendor=vendor,
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
        transaction.on_commit(lambda: _notify_delivery_parties(trip))
    return trip


def _resolve_delivery_parties(passenger, subtype, options, vendor):
    """
    Who hands the item over (sender) and who takes it (recipient), with the booker filled in
    on whichever side they are, so a client that leaves a side blank still works:

      parcel        recipient required. Sender defaults to the booker (they're sending). If the
                    booker is the recipient (they're receiving), the sender must be given.
      errand        recipient defaults to the booker. The courier needs a contact at the
                    pickup, so a sender name is required (phone optional).
      vendor_order  recipient defaults to the booker. The sender defaults to the vendor.
    """
    me_name = (passenger.name or "").strip()
    me_phone = _normalize(passenger.real_phone)

    def clean(key):
        return (options.get(key) or "").strip()

    sender_name, sender_phone = clean("sender_name"), _normalize(options.get("sender_phone"))
    recipient_name, recipient_phone = clean("recipient_name"), _normalize(options.get("recipient_phone"))

    if subtype != DeliveryDetail.Subtype.PARCEL and not (recipient_name or recipient_phone):
        recipient_name, recipient_phone = me_name, me_phone
    if subtype == DeliveryDetail.Subtype.PARCEL:
        missing = [f for f, v in (("recipient_name", recipient_name), ("recipient_phone", recipient_phone)) if not v]
        if missing:
            raise TripRequestError(f"Deliveries need: {', '.join(missing)}.")
        if not (sender_name or sender_phone):
            if recipient_phone and recipient_phone == me_phone:
                raise TripRequestError("Tell us who is sending it to you (name and phone), so the courier can collect it.")
            sender_name, sender_phone = me_name, me_phone
    elif subtype == DeliveryDetail.Subtype.VENDOR_ORDER and vendor and not (sender_name or sender_phone):
        sender_name, sender_phone = vendor.name, _normalize(vendor.phone)
    if subtype == DeliveryDetail.Subtype.PARCEL and not sender_phone:
        raise TripRequestError("Deliveries need: sender_phone.")
    if subtype == DeliveryDetail.Subtype.ERRAND and not sender_name:
        raise TripRequestError("Tell the courier who to collect from (a name, and a phone if you have one).")
    if subtype != DeliveryDetail.Subtype.PARCEL and not (recipient_name and recipient_phone):
        raise TripRequestError("Deliveries need a recipient name and phone. Add your own details in your profile, or fill them in.")
    return {"sender_name": sender_name, "sender_phone": sender_phone,
            "recipient_name": recipient_name, "recipient_phone": recipient_phone}


def _resolve_vendor(options):
    """WR-25: vendor_order lookup/creation. vendor_id wins if given (picked from
    autocomplete); otherwise vendor_name (+ optional vendor_location/vendor_phone) creates
    or reuses a Vendor row, matched case-insensitively so "Vero's Kitchen" and "vero's
    kitchen" don't become two rows."""
    vendor_id = options.get("vendor_id")
    if vendor_id:
        try:
            return Vendor.objects.get(id=vendor_id)
        except Vendor.DoesNotExist as exc:
            raise TripRequestError("That vendor couldn't be found. Pick one from the list or type a new name.") from exc

    vendor_name = (options.get("vendor_name") or "").strip()
    if not vendor_name:
        raise TripRequestError("Tell us which vendor to collect from.")
    vendor, _created = Vendor.objects.get_or_create(
        name__iexact=vendor_name,
        defaults={
            "name": vendor_name,
            "location_label": (options.get("vendor_location") or "").strip(),
            "phone": _normalize(options["vendor_phone"]) if options.get("vendor_phone") else "",
        },
    )
    return vendor


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


def _notify_delivery_parties(trip):
    """
    WR-23/25: each third party gets the code they need, plus a live tracking link. The sender is
    texted the pickup code and the recipient the drop-off code, but only if they aren't the
    booker — the booker sees both codes in their own app instead.
    """
    import logging

    from accounts.services import _send_sms
    from safety.models import TripShare
    from safety.services import share_url

    delivery = trip.delivery
    booker_phone = _normalize(trip.passenger.real_phone)
    booker = trip.passenger.name or "Someone"
    texts = []
    if delivery.sender_phone and delivery.sender_phone != booker_phone:
        texts.append((delivery.sender_phone, "pickup"))
    if delivery.recipient_phone and delivery.recipient_phone != booker_phone:
        texts.append((delivery.recipient_phone, "dropoff"))
    if not texts:
        return
    share = TripShare.objects.create(trip=trip, created_by=trip.passenger, sent_to_phone=texts[-1][0])
    link = share_url(share)
    for phone, role in texts:
        if role == "pickup":
            what = delivery.task_description or delivery.package_description or "an item"
            message = (f"{booker} has booked a WolbiRides courier to collect from you: {what}. "
                       f"Give the rider code {delivery.pickup_code} only when they collect it. Track it: {link}")
        elif delivery.delivery_subtype == DeliveryDetail.Subtype.PARCEL:
            message = (f"{booker} is sending you a package with WolbiRides. Give the rider code "
                       f"{delivery.dropoff_code} only when you receive it. Track it: {link}")
        else:
            message = (f"{booker} has ordered something to be delivered to you with WolbiRides. Give the rider code "
                       f"{delivery.dropoff_code} only when you receive it. Track it: {link}")
        try:
            _send_sms(phone, message)
        except Exception:
            logging.getLogger(__name__).exception("Failed to SMS delivery %s for trip %s", role, trip.id)


# --- Dispatch -------------------------------------------------------------------------

def start_dispatch_cascade(trip):
    """WR-17: a shareable request first tries to share (join a driver already heading
    out, or pair with another passenger still searching); otherwise normal dispatch."""
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
    if not candidates and trip.trip_type == Trip.Kind.DELIVERY:
        # WR-26: nobody nearby took it, so ops arrange a courier rather than the passenger being told "no drivers".
        reason = no_drivers_reason(trip, meta)
        _log_event(trip, "no_drivers_found", {"reason": reason, "counts": meta.get("counts", {})})
        send_to_admin(trip, "no_courier_accepted", detail=reason)
        return None
    if not candidates:
        trip.status = Trip.Status.NO_DRIVERS_FOUND
        trip.save(update_fields=["status", "updated_at"])
        _log_event(trip, "no_drivers_found", {"reason": no_drivers_reason(trip, meta), "counts": meta.get("counts", {})})
        _broadcast_trip_update(trip)
        from trips import pooling

        pooling.on_trip_ended(trip)
        return None

    next_driver_id = candidates[0]
    _offer_to_driver(trip, next_driver_id, meta)
    return next_driver_id


def no_drivers_reason(trip, meta):
    """Why nobody could be offered the trip, as a short code the apps turn into plain words."""
    c = meta.get("counts", {})
    if not c.get("reporting_location"):
        return "none_online"
    if not c.get("verified_and_online"):
        return "none_online"
    if not c.get("free"):
        return "all_busy"
    if trip.trip_type == Trip.Kind.DELIVERY and not c.get("taking_deliveries"):
        return "no_delivery_couriers"
    return "already_offered"  # everyone eligible has already been offered and passed


def order_candidates(trip, scored):
    """
    Returns (driver_user_ids_in_offer_order, meta).

    - Drivers already heading to or carrying a passenger are skipped (shared passengers
      reach them through pooling instead).
    - Deliveries only go to drivers who opted in (WR-23).
    - WR-19 driver-gender preference: only matching drivers, until the passenger
      says otherwise. If none is available, meta["blocked_by_preference"] is
      set and the passenger is asked; nobody is silently reassigned.
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

    meta = {"blocked_by_preference": False, "fair_queue": False, "nearest_km": None, "distances": {},
            "counts": {"reporting_location": len(scored)}}
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
    meta["counts"]["verified_and_online"] = len(drivers)
    scored = [(dist, i) for dist, i in scored if i not in busy and i in drivers]
    meta["counts"]["free"] = len(scored)
    if trip.trip_type == Trip.Kind.DELIVERY:
        scored = [(dist, i) for dist, i in scored if drivers[i].accepts_deliveries]
        meta["counts"]["taking_deliveries"] = len(scored)

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
    """WR-19: no driver matching the passenger's preference is free. Ask the passenger,
    or (if they already chose to keep waiting) try again shortly."""
    from core.models import notify
    from trips.tasks import retry_preference_dispatch

    if trip.preference_status == Trip.PreferenceStatus.KEEP_WAITING:
        attempts = trip.events.filter(event_type="preference_retry").count()
        if attempts < 10:
            _log_event(trip, "preference_retry", {"attempt": attempts + 1})
            retry_preference_dispatch.apply_async(args=[str(trip.id)], countdown=30)
            return
    trip.preference_status = Trip.PreferenceStatus.AWAITING_PASSENGER
    trip.save(update_fields=["preference_status", "updated_at"])
    _log_event(trip, "preference_unavailable")
    _broadcast_trip_update(trip)
    notify(trip.passenger, "No matching rider free right now",
           "Take the next available rider, or keep waiting for one that matches your preference.",
           category="trip", link=f"/trip/{trip.id}")


def preference_decision(trip, decision):
    """Passenger's answer when their preferred driver isn't available: 'any_driver' or 'keep_waiting'."""
    if trip.status != Trip.Status.MATCHING or trip.preference_status not in (
        Trip.PreferenceStatus.AWAITING_PASSENGER, Trip.PreferenceStatus.KEEP_WAITING,
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


def _offer_payload(trip, timeout_seconds):
    """The job as a driver sees it, whether pushed live or fetched via GET (offer_for_driver) —
    never the passenger's preferences or why they were chosen (WR-19)."""
    from trips import pooling

    payload = {
        "trip_id": str(trip.id),
        "pickup_label": trip.pickup_label,
        "destination_label": trip.destination_label,
        "fare_estimate": str(trip.fare_quote.total),
        "trip_type": trip.trip_type,
        "kind": trip.trip_type,  # legacy alias for older app builds
        "timeout_seconds": timeout_seconds,
        "expires_at": (timezone.now() + timezone.timedelta(seconds=timeout_seconds)).isoformat(),
    }
    if trip.trip_type == Trip.Kind.DELIVERY and hasattr(trip, "delivery"):
        d = trip.delivery
        payload.update({
            "delivery_subtype": d.delivery_subtype,
            "package_description": d.package_description,
            "package_size": d.package_size,
            "task_description": d.task_description,
            "spend_limit": str(d.spend_limit) if d.spend_limit is not None else None,
            "vendor_name": d.vendor.name if d.vendor_id else "",
        })
    legs = pooling.offer_legs(trip)
    if legs:
        payload["pool_legs"] = legs
        payload["fare_estimate"] = str(sum(Decimal(l["fare"]) for l in legs if l["type"] == "pickup"))
    return payload


def _offer_to_driver(trip, driver_id, meta=None, timeout_seconds=None):
    timeout_seconds = timeout_seconds or DISPATCH_OFFER_TIMEOUT_SECONDS
    payload = _offer_payload(trip, timeout_seconds)

    async_to_sync(get_channel_layer().group_send)(
        f"driver.{driver_id}", {"type": "ride_request", "trip": payload},
    )
    meta = meta or {}
    event = {"driver_id": driver_id}
    if meta.get("nearest_km") is not None and driver_id in meta.get("distances", {}):
        event["extra_km"] = round(meta["distances"][driver_id] - meta["nearest_km"], 3)
        event["fair_queue"] = meta.get("fair_queue", False)
    if meta.get("admin_offer"):
        event["admin_offer"] = True
        event["admin_id"] = meta.get("admin_id")
    _log_event(trip, "offered_to_driver", event)

    from trips.tasks import check_dispatch_offer_timeout

    check_dispatch_offer_timeout.apply_async(
        args=[str(trip.id), driver_id], countdown=timeout_seconds
    )


def current_offered_driver_id(trip):
    """User id of the driver the trip is currently offered to, or None.

    Offers are keyed by the driver's *user* id everywhere in dispatch
    (Redis online set, websocket group, offered_to_driver events), so this
    is the value to compare against — never the Driver row's own pk.
    """
    event = _current_offer_event(trip)
    return (event.payload or {}).get("driver_id") if event else None


def _current_offer_event(trip):
    return trip.events.filter(event_type="offered_to_driver").order_by("-created_at").first()


def offer_for_driver(driver_user_id):
    """The offer (same shape _offer_to_driver pushes) currently pending this driver's response, or
    None — fetchable directly so a driver who reopens the app (or never got the push at all, e.g.
    Expo Go's lack of remote push) can still see and act on it, not only through the live message."""
    from django.conf import settings

    trips = (
        Trip.objects.filter(status=Trip.Status.MATCHING)
        .select_related("fare_quote", "delivery", "delivery__vendor")
        .order_by("-requested_at")
    )
    for t in trips:
        event = _current_offer_event(t)
        if event and (event.payload or {}).get("driver_id") == str(driver_user_id):
            is_admin = bool((event.payload or {}).get("admin_offer"))
            timeout_seconds = settings.ADMIN_OFFER_TIMEOUT_SECONDS if is_admin else DISPATCH_OFFER_TIMEOUT_SECONDS
            elapsed = (timezone.now() - event.created_at).total_seconds()
            remaining = max(0, timeout_seconds - elapsed)
            if remaining <= 0:
                continue  # timed out; the Celery task just hasn't cleaned it up yet
            payload = _offer_payload(t, timeout_seconds)
            payload["timeout_seconds"] = round(remaining)  # time left, not the original window
            payload["admin_offer"] = is_admin
            return payload
    return None


def accept_trip(trip, driver):
    """Driver accepted within the offer window.

    Locked and checked so only the driver currently offered the trip can
    accept, they must still be verified, and two accepts can't both win.
    Passengers waiting on this trip's shared group are matched to the same driver.
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
            raise OfferNotValid("Only verified riders can accept trips.")
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
        logging.getLogger(__name__).warning("Couldn't push tracking mode to rider %s", driver.user_id)
    from core.models import notify

    notify(trip.passenger, "Rider assigned", f"{driver.user.name or 'Your rider'} is on the way.",
           category="trip", link=f"/trip/{trip.id}")
    for other in joined:
        _broadcast_trip_update(other)
        notify(other.passenger, "Shared ride matched", f"{driver.user.name or 'Your rider'} is on the way.",
               category="trip", link=f"/trip/{other.id}")
    return trip


def decline_or_timeout(trip, driver_user_id):
    """Driver declined, or their offer expired.

    A no-op unless the trip is still MATCHING *and* still offered to this driver. An organic
    dispatch offer cascades to the next nearby candidate as before. An offer ops sent directly
    to one driver has no "next candidate" to fall back to — it goes back to the ops queue so a
    person decides what happens next, rather than silently searching nearby drivers for a job
    ops deliberately chose not to auto-dispatch.
    """
    with transaction.atomic():
        trip = Trip.objects.select_for_update(of=("self",)).select_related("delivery").get(id=trip.id)
        event = _current_offer_event(trip)
        if trip.status != Trip.Status.MATCHING or not event or (event.payload or {}).get("driver_id") != str(driver_user_id):
            return None
        is_admin_offer = bool((event.payload or {}).get("admin_offer"))
        _log_event(trip, "declined_or_timed_out", {"driver_id": str(driver_user_id)})
    if is_admin_offer:
        return _return_to_admin(trip, "driver_declined")
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

    notify(trip.passenger, "Your rider is close by", "Head to your pickup point now.", category="trip", link=f"/trip/{trip.id}")
    return trip


def check_and_mark_driver_arriving(driver_user_id, lat, lng):
    """Called from location pings. A driver can have two waiting passengers on a shared ride.
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
    if (cancelled_by == "driver" and trip.trip_type == Trip.Kind.DELIVERY
            and trip.status in (Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING)):
        # WR-26: the sender and recipient are counting on this. Ops find another courier; nobody is left stranded.
        return _return_to_admin(trip, "driver_withdrew", reason)
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
    elif not trip.driver:
        # A pending offer (matching, not yet accepted) has no trip.driver yet — tell whoever it
        # was offered to that it's gone, so their countdown doesn't sit there for nothing.
        offered_id = current_offered_driver_id(trip)
        if offered_id and cancelled_by != "driver":
            from accounts.models import User

            offered = User.objects.filter(id=offered_id).first()
            if offered:
                notify(offered, "Delivery no longer available", "That one was cancelled.", category="trip", link="/requests")
    return trip


# --- WR-26: deliveries arranged by ops ------------------------------------------------

def delivery_goes_to_admin_first(trip):
    from django.conf import settings

    return (trip.trip_type == Trip.Kind.DELIVERY and hasattr(trip, "delivery")
            and trip.delivery.delivery_subtype in settings.DELIVERY_ADMIN_FIRST_SUBTYPES)


def route_new_trip(trip):
    """Where a fresh booking goes first: straight to nearby drivers, or, for errands and vendor
    orders (a cash float, a third party, vague instructions), to ops to check and assign."""
    if delivery_goes_to_admin_first(trip):
        send_to_admin(trip, "review")
        return None
    return start_dispatch_cascade(trip)


_QUEUE_WHY = {
    "review": "Errands and vendor orders are checked by ops first.",
    "no_courier_accepted": "No rider took it.",
    "driver_withdrew": "The rider withdrew.",
    "reassigned": "It was taken off its courier.",
}


def send_to_admin(trip, reason, detail=""):
    """Puts a delivery in the ops queue (status: awaiting_assignment) and tells ops and the passenger."""
    from django.contrib.auth import get_user_model

    from core.models import notify

    trip.status = Trip.Status.AWAITING_ASSIGNMENT
    trip.save(update_fields=["status", "updated_at"])
    _log_event(trip, "sent_to_admin", {"reason": reason, "detail": detail})
    _broadcast_trip_update(trip)

    d = trip.delivery
    what = (d.task_description or d.package_description or "A delivery")[:80]
    for staff in get_user_model().objects.filter(role__in=["admin", "support"], is_active=True):
        notify(staff, "Delivery needs a courier",
               f"{what}: {trip.pickup_label} to {trip.destination_label}. {_QUEUE_WHY.get(reason, '')}".strip(),
               category="system", link="/deliveries")
    if reason in ("driver_withdrew", "reassigned"):
        body = "Your courier can't make it. We're finding you another one and will tell you as soon as they're assigned."
    else:
        body = "Our team is finding you a courier. We'll tell you as soon as one is assigned."
    notify(trip.passenger, "We're arranging your delivery", body, category="trip", link=f"/trip/{trip.id}")


def _return_to_admin(trip, reason, detail=""):
    driver = trip.driver
    trip.driver = None
    trip.matched_at = None
    trip.save(update_fields=["driver", "matched_at", "updated_at"])
    if trip.delivery.external_courier_id:
        trip.delivery.external_courier = None
        trip.delivery.save(update_fields=["external_courier", "updated_at"])
    if driver:
        from core.models import notify

        notify(driver.user, "Delivery reassigned", "Ops took this delivery off you.", category="trip", link="/")
    send_to_admin(trip, reason, detail=detail)
    return trip


def _lock_awaiting(trip):
    # of=("self",) locks only the trip row. Without it, Postgres refuses outright: a delivery is
    # a reverse OneToOne, so a trip with none is a LEFT OUTER JOIN, and Postgres will not let
    # FOR UPDATE reach the nullable side of one. select_related still runs, just unlocked.
    trip = Trip.objects.select_for_update(of=("self",)).select_related("delivery").get(id=trip.id)
    if trip.trip_type != Trip.Kind.DELIVERY:
        raise AssignmentError("Only deliveries are arranged by ops.")
    if trip.status != Trip.Status.AWAITING_ASSIGNMENT:
        raise AssignmentError("This delivery isn't waiting for a courier.")
    return trip


def delivery_couriers_for(trip):
    """Drivers ops can hand this delivery to: verified, online, taking deliveries and not already on a
    trip. Nearest first when their live position is known."""
    from drivers.models import Driver

    busy = set(Trip.objects.filter(status__in=ACTIVE_STATUSES, driver__isnull=False).values_list("driver_id", flat=True))
    drivers = (Driver.objects.filter(verification_status=Driver.VerificationStatus.VERIFIED, is_online=True,
                                     accepts_deliveries=True).exclude(id__in=busy).select_related("user"))
    try:
        km = {uid: dist for dist, uid in async_to_sync(scored_candidate_drivers)(str(trip.zone_id), trip.pickup_lat, trip.pickup_lng)}
    except Exception:
        km = {}  # presence is best-effort; ops can still pick from the list
    rows = [{
        "driver_id": str(d.id), "name": d.user.name or "Rider", "phone": d.user.real_phone,
        "distance_km": round(km[str(d.user_id)], 1) if str(d.user_id) in km else None,
    } for d in drivers]
    rows.sort(key=lambda r: (r["distance_km"] is None, r["distance_km"] or 0))
    return rows


def admin_offer_to_driver(trip, driver, admin):
    """
    WR-26: ops picks a driver for a delivery, but it isn't matched to them yet — it's *offered*,
    the same as an organic dispatch offer, just aimed at the one driver ops chose rather than a
    race among the nearest few. The driver gets the same accept/decline window (a longer one:
    ADMIN_OFFER_TIMEOUT_SECONDS, not the snap organic one) and the same push, so it shows up on
    their existing offer screen and countdown — nothing new for them to learn. Declining, or
    letting it time out, returns it to the ops queue (decline_or_timeout) rather than the organic
    cascade, since there's no "next nearest driver" ops meant to fall back to.
    """
    from django.conf import settings
    from drivers.models import Driver

    with transaction.atomic():
        trip = _lock_awaiting(trip)
        if driver.verification_status != Driver.VerificationStatus.VERIFIED:
            raise AssignmentError("Only verified riders can take deliveries.")
        if Trip.objects.filter(driver=driver, status__in=ACTIVE_STATUSES).exists():
            raise AssignmentError(f"{driver.user.name or 'That rider'} is already on a trip.")
        if offer_for_driver(str(driver.user_id)):
            raise AssignmentError(f"{driver.user.name or 'That rider'} already has a delivery offer pending.")
        trip.status = Trip.Status.MATCHING
        trip.save(update_fields=["status", "updated_at"])
        trip.delivery.external_courier = None
        trip.delivery.save(update_fields=["external_courier", "updated_at"])
    _broadcast_trip_update(trip)
    _offer_to_driver(trip, str(driver.user_id), meta={"admin_offer": True, "admin_id": str(admin.id)},
                      timeout_seconds=settings.ADMIN_OFFER_TIMEOUT_SECONDS)
    from core.models import notify

    d = trip.delivery
    notify(driver.user, "New delivery request",
           f"{(d.task_description or d.package_description or 'A delivery')[:80]}. Review it under Requests.",
           category="trip", link="/requests")
    return trip


def assign_delivery_to_external(trip, courier, admin):
    from core.models import notify

    if not courier.active:
        raise AssignmentError("That courier is marked inactive.")
    with transaction.atomic():
        trip = _lock_awaiting(trip)
        trip.driver = None
        trip.status = Trip.Status.MATCHED
        trip.matched_at = timezone.now()
        trip.save(update_fields=["driver", "status", "matched_at", "updated_at"])
        trip.delivery.external_courier = courier
        trip.delivery.save(update_fields=["external_courier", "updated_at"])
        _log_event(trip, "assigned_external", {"courier_id": str(courier.id), "admin_id": str(admin.id)})
    _broadcast_trip_update(trip)
    notify(trip.passenger, "Courier assigned", f"{courier.name} is on the way to collect it.", category="trip", link=f"/trip/{trip.id}")
    return trip


def unassign_delivery(trip, admin):
    """Ops take a delivery back off its courier (before pickup) and return it to the queue."""
    with transaction.atomic():
        # Same fix as _lock_awaiting: lock only the trip row, not the nullable delivery join.
        trip = Trip.objects.select_for_update(of=("self",)).select_related("delivery").get(id=trip.id)
        if trip.trip_type != Trip.Kind.DELIVERY or trip.status not in (Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING):
            raise AssignmentError("Only a delivery that hasn't been picked up yet can be taken off its courier.")
        _log_event(trip, "unassigned_by_admin", {"admin_id": str(admin.id)})
        return _return_to_admin(trip, "reassigned")


def _require_external(trip):
    if trip.trip_type != Trip.Kind.DELIVERY or not trip.delivery.external_courier_id:
        raise TripFlowError("This delivery isn't with an external courier.")


def admin_confirm_pickup(trip, admin, code="", by_phone=False):
    """Ops record pickup for an external courier, who has no app: with the code the sender gave them, or after ops
    checked it with the sender by phone. The code is never shown to ops; the courier reads it out."""
    _require_external(trip)
    if trip.status not in (Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING):
        raise TripFlowError("This delivery can't be picked up now.")
    code = (code or "").strip()
    if code:
        if code != trip.delivery.pickup_code:
            raise DeliveryCodeError("That pickup code doesn't match. Ask the courier to check it with the sender.")
    elif not by_phone:
        raise DeliveryCodeError("Enter the pickup code the courier was given, or confirm you checked it by phone.")
    trip.delivery.picked_up_at = timezone.now()
    trip.delivery.save(update_fields=["picked_up_at", "updated_at"])
    _log_event(trip, "delivery_picked_up", {"by": "admin_code" if code else "admin_phone", "admin_id": str(admin.id)})
    return _begin(trip)


def admin_confirm_dropoff(trip, admin, code="", by_phone=False):
    _require_external(trip)
    if trip.status != Trip.Status.IN_PROGRESS:
        raise TripFlowError("Confirm pickup before drop-off.")
    code = (code or "").strip()
    if code:
        if code != trip.delivery.dropoff_code:
            raise DeliveryCodeError("That code doesn't match. Ask the courier to check it with the recipient.")
    elif not by_phone:
        raise DeliveryCodeError("Enter the drop-off code the recipient gave the courier, or confirm you checked it by phone.")
    _log_event(trip, "delivery_dropped_off", {"by": "admin_code" if code else "admin_phone", "admin_id": str(admin.id)})
    return _finish(trip)


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
        "fare_quote", "driver__user", "passenger", "organization", "delivery", "delivery__vendor", "delivery__external_courier",
        "pool_group",
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
