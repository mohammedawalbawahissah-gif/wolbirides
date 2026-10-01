from core.throttling import ActionRateThrottle
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.services import mark_saved_address_used
from core.permissions import IsAdminRole, IsPassengerRole
from trips import services
from trips.models import Rating, Trip, Vendor
from trips.serializers import (
    RatingSerializer,
    TripCancelSerializer,
    TripRequestSerializer,
    TripSerializer,
    VendorSerializer,
)
from zones.models import ServiceZone
from bundles.services import BundleError
from organizations.services import OrganizationBillingError
from partners.services import PromoError

REQUEST_ERRORS = (services.TripRequestError, PromoError, OrganizationBillingError, BundleError)


class TripRequestView(APIView):
    """POST /api/trips — PRD Section 6.2 step 1, then kicks off dispatch. Passengers only."""

    permission_classes = [IsAuthenticated, IsPassengerRole]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "trip_request"

    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        zone = get_object_or_404(ServiceZone, id=data["zone_id"], active=True)

        try:
            trip = self._create(request, data, zone)
        except REQUEST_ERRORS as exc:  # each carries passenger-friendly text
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if data.get("pickup_saved_address_id"):
            mark_saved_address_used(request.user, data["pickup_saved_address_id"])
        if data.get("destination_saved_address_id"):
            mark_saved_address_used(request.user, data["destination_saved_address_id"])

        services.route_new_trip(trip)
        trip.refresh_from_db()
        return Response(TripSerializer(trip, context={"request": request}).data, status=status.HTTP_201_CREATED)

    def _create(self, request, data, zone):
        return services.request_trip(
            passenger=request.user,
            zone=zone,
            pickup={"lat": data["pickup_lat"], "lng": data["pickup_lng"], "label": data.get("pickup_label", "")},
            destination={
                "lat": data["destination_lat"],
                "lng": data["destination_lng"],
                "label": data.get("destination_label", ""),
            },
            client_reported_distance_km=data.get("distance_km"),
            options={
                key: data.get(key)
                for key in (
                    "trip_type", "kind", "delivery_subtype", "sender_name", "sender_phone",
                    "recipient_name", "recipient_phone", "package_description", "package_size",
                    "task_description", "spend_limit", "vendor_id", "vendor_name", "vendor_location", "vendor_phone",
                    "preferences", "shareable", "is_pool", "payment_method", "organization_id", "voucher_id",
                    "bundle_id", "promo_code",
                ) if data.get(key) is not None
            },
        )


class TripDetailView(APIView):
    """GET /api/trips/:id"""

    permission_classes = [IsAuthenticated]

    def get(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not services.user_can_access_trip(request.user, trip):
            raise PermissionDenied()
        return Response(TripSerializer(trip, context={"request": request}).data)


class TripCancelView(APIView):
    """POST /api/trips/:id/cancel"""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not services.user_can_access_trip(request.user, trip):
            raise PermissionDenied()
        serializer = TripCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled_by = "driver" if request.user.role == "driver" else "passenger"
        trip = services.cancel_trip(trip, cancelled_by, serializer.validated_data["reason"])
        return Response(TripSerializer(trip, context={"request": request}).data)


class TripCompleteView(APIView):
    """POST /api/trips/:id/complete — driver marks trip done."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not trip.driver or trip.driver.user_id != request.user.id:
            raise PermissionDenied("Only the assigned rider can complete this trip")
        try:
            trip = services.complete_trip(trip, delivery_code=request.data.get("delivery_code"))
        except services.DeliveryCodeError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except services.TripFlowError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TripSerializer(trip, context={"request": request}).data)


class PassengerTripHistoryView(APIView):
    """GET /api/passengers/me/rides[?before=<iso datetime>] — PRD Section 7, paged 50 at a time."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        trips = services.history_page(services.trip_list_queryset(request.user).filter(passenger=request.user), request)
        return Response(TripSerializer(trips, many=True, context={"request": request}).data)


class TripAcceptView(APIView):
    """POST /api/trips/:id/accept — driver accepts an offered trip."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only riders can accept trips")
        try:
            trip = services.accept_trip(trip, request.user.driver_profile)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TripSerializer(trip, context={"request": request}).data)


class TripDeclineView(APIView):
    """POST /api/trips/:id/decline — driver declines an offer; cascades to the next candidate."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only riders can decline trips")
        result = services.decline_or_timeout(trip, str(request.user.id))
        if result is None and services.current_offered_driver_id(trip) != str(request.user.id):
            # Either the offer already moved on (timeout) or it was never
            # this driver's — nothing to decline.
            return Response({"detail": "This trip isn't currently offered to you."}, status=status.HTTP_409_CONFLICT)
        return Response({"detail": "declined"})


class TripStartView(APIView):
    """POST /api/trips/:id/start — driver marks trip as started (pickup complete)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not trip.driver or trip.driver.user_id != request.user.id:
            raise PermissionDenied("Only the assigned rider can start this trip")
        try:
            trip = services.start_trip(trip)
        except services.TripFlowError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TripSerializer(trip, context={"request": request}).data)


class DriverCurrentOfferView(APIView):
    """GET /api/drivers/me/current-offer — the offer pending this driver's response right now, or
    null. A driver reopening the app (or one whose push never arrived — remote push doesn't work
    at all in Expo Go, and can be dropped even on a real build) can still see and act on it here,
    the same as the live push shows in the moment, rather than only through that one message."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only riders can query this")
        return Response(services.offer_for_driver(str(request.user.id)))


class DriverActiveTripView(APIView):
    """
    GET /api/drivers/me/active-trip — lets the driver app recover state on
    load/reconnect (e.g. after a refresh mid-trip) without tracking trip_id
    client-side across sessions.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only riders can query this")
        trip = (
            Trip.objects.filter(
                driver=request.user.driver_profile,
                status__in=[Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING, Trip.Status.IN_PROGRESS],
            )
            .order_by("-requested_at")
            .first()
        )
        if not trip:
            return Response(None)
        return Response(TripSerializer(trip, context={"request": request}).data)


class TripRatingView(APIView):
    """POST /api/trips/:id/rating"""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        # Only the two people on the trip rate it (admins can view trips, but not rate them).
        is_party = trip.passenger_id == request.user.id or bool(trip.driver and trip.driver.user_id == request.user.id)
        if not is_party:
            raise PermissionDenied()
        if trip.status != Trip.Status.COMPLETED or not trip.driver_id:
            return Response({"detail": "You can rate a trip once it's complete."}, status=status.HTTP_409_CONFLICT)
        if Rating.objects.filter(trip=trip, rater=request.user).exists():
            return Response({"detail": "You've already rated this trip."}, status=status.HTTP_409_CONFLICT)

        rated_user = trip.driver.user if request.user.id == trip.passenger_id else trip.passenger
        serializer = RatingSerializer(data={**request.data, "trip": trip.id, "rated": rated_user.id})
        serializer.is_valid(raise_exception=True)
        rating = Rating.objects.create(
            trip=trip,
            rater=request.user,
            rated=rated_user,
            score=serializer.validated_data["score"],
            issue_tags=serializer.validated_data.get("issue_tags", []),
            comment=serializer.validated_data.get("comment", ""),
        )
        return Response(RatingSerializer(rating).data, status=status.HTTP_201_CREATED)


# --- WR-19: ride preferences -------------------------------------------------

class RidePreferenceView(APIView):
    """GET/PUT /api/passengers/me/ride-preferences — WR-19 defaults, copied onto each new trip.

    Never exposed to drivers, other passengers, or admin list views.
    """

    permission_classes = [IsAuthenticated]
    BOOL_FIELDS = ("prefer_previous_drivers", "quiet_ride", "needs_luggage_space", "needs_accessibility_help")

    def get(self, request):
        from trips.models import TripPreference

        pref, _ = TripPreference.objects.get_or_create(user=request.user)
        return Response(pref.as_dict())

    def put(self, request):
        from trips.models import TripPreference

        pref, _ = TripPreference.objects.get_or_create(user=request.user)
        for field in self.BOOL_FIELDS:
            if field in request.data:
                setattr(pref, field, bool(request.data[field]))
        if "preferred_driver_gender" in request.data:
            gender = request.data.get("preferred_driver_gender") or ""
            if gender not in services.GENDER_CHOICES:
                return Response({"detail": "preferred_driver_gender must be '', 'female' or 'male'."}, status=400)
            pref.preferred_driver_gender = gender
        pref.save()
        return Response(pref.as_dict())


class TripPreferenceDecisionView(APIView):
    """POST /api/trips/:id/preference-decision {decision: any_driver | keep_waiting} — WR-19."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id, passenger=request.user)
        try:
            services.preference_decision(trip, request.data.get("decision"))
        except services.TripFlowError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        trip.refresh_from_db()
        return Response(TripSerializer(trip, context={"request": request}).data)


class DeliveryConfirmView(APIView):
    """POST /api/trips/:id/confirm-pickup {code?, photo_url?} and /confirm-dropoff {code, photo_url?} — WR-23."""

    permission_classes = [IsAuthenticated]
    step = "pickup"

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not trip.driver or trip.driver.user_id != request.user.id:
            raise PermissionDenied("Only the assigned rider can confirm this delivery")
        code, photo = request.data.get("code", ""), request.data.get("photo_url", "")
        try:
            if self.step == "pickup":
                trip = services.confirm_pickup(trip, code, photo)
            else:
                trip = services.confirm_dropoff(trip, code, photo)
        except services.DeliveryCodeError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except services.TripFlowError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TripSerializer(trip, context={"request": request}).data)


# --- WR-21/22: what this passenger can pay with ------------------------------

class VendorSearchView(APIView):
    """GET /api/vendors?q=... — WR-25 autocomplete when booking a vendor_order delivery.
    Global for now (no zone filter — see Vendor.zone's docstring); returns closest name
    matches first, capped small since this backs a type-ahead, not a browse list."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        vendors = Vendor.objects.all()
        if query:
            vendors = vendors.filter(name__icontains=query)
        vendors = vendors.order_by("name")[:8]
        return Response(VendorSerializer(vendors, many=True).data)


class PaymentOptionsView(APIView):
    """GET /api/passengers/me/payment-options — organizations and bundles usable right now."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from bundles.services import usable_bundles
        from organizations.services import active_memberships, member_allowance, usable_vouchers

        orgs = []
        for m in active_memberships(request.user):
            allowance = member_allowance(m)
            orgs.append({
                "id": str(m.organization_id), "name": m.organization.name,
                "remaining_this_month": None if allowance is None else str(max(allowance, 0)),
            })
        bundles = [{
            "id": str(b.id), "name": b.plan.name, "rides_remaining": b.rides_remaining,
            "max_fare_per_ride": str(b.max_fare_per_ride), "expires_at": b.expires_at,
        } for b in usable_bundles(request.user)]
        vouchers = [{
            "id": str(v.id), "organization": v.organization.name, "code": v.code, "kind": v.kind,
            "value_remaining": str(v.value_remaining) if v.value_remaining is not None else None,
            "rides_remaining": v.rides_remaining, "expires_at": v.expires_at,
        } for v in usable_vouchers(request.user)]
        return Response({"organizations": orgs, "vouchers": vouchers, "bundles": bundles})


# --- WR-20: is dispatch fair? ------------------------------------------------

def _gini(values):
    values = sorted(values)
    n, total = len(values), sum(values)
    if n == 0 or total == 0:
        return 0
    cumulative = sum((i + 1) * v for i, v in enumerate(values))
    return round((2 * cumulative) / (n * total) - (n + 1) / n, 3)


def _p90_p10(values):
    if not values:
        return None
    values = sorted(values)
    p90 = values[min(len(values) - 1, int(round(0.9 * (len(values) - 1))))]
    p10 = values[int(round(0.1 * (len(values) - 1)))]
    return round(p90 / p10, 2) if p10 else None


class AdminTrustIndicatorsView(APIView):
    """
    GET /api/admin/trust-indicators?days=30 — the Growth PRD's three cross-cutting signals that
    efficiency work has started trading against passengers' and drivers' trust.
    """

    permission_classes = [IsAdminRole]
    PRESSURE_PHRASES = ("felt pressured", "pressured", "didn't realize", "didnt realize", "did not realize",
                        "didn't know", "without asking", "charged without", "forced", "tricked")

    def get(self, request):
        from django.db.models import Q
        from django.utils import timezone

        from accounts.models import User
        from core.models import NotificationPreference

        days = min(int(request.query_params.get("days", 30)), 365)
        since = timezone.now() - timezone.timedelta(days=days)

        passengers = User.objects.filter(role="passenger", is_active=True).count()
        opted_out = NotificationPreference.objects.filter(enabled=False).values("user").distinct().count()

        from support.models import SupportTicket

        q = Q()
        for phrase in self.PRESSURE_PHRASES:
            q |= Q(subject__icontains=phrase) | Q(description__icontains=phrase)
        tickets = SupportTicket.objects.filter(created_at__gte=since)
        pressured = tickets.filter(q)

        week_ago = timezone.now() - timezone.timedelta(days=7)
        from drivers.models import Driver

        from django.db.models import Count

        counts = list(Driver.objects.filter(verification_status="verified").annotate(
            n=Count("trips_as_driver", filter=Q(trips_as_driver__status=Trip.Status.COMPLETED,
                                                 trips_as_driver__completed_at__gte=week_ago)),
        ).values_list("n", flat=True))
        return Response({
            "days": days,
            "notification_opt_out": {
                "users_opted_out": opted_out, "passengers": passengers,
                "rate": round(opted_out / passengers, 3) if passengers else 0,
                "what_it_catches": "Alerts drifting from useful to intrusive (WR-16).",
            },
            "driver_trip_distribution_7d": {
                "gini": _gini(counts), "p90_p10_ratio": _p90_p10(counts), "drivers": len(counts),
                "what_it_catches": "Dispatch quietly concentrating work on a few riders (WR-20).",
            },
            "pressure_language_tickets": {
                "count": pressured.count(), "of_all_tickets": tickets.count(),
                "recent": [{"id": str(t.id), "subject": t.subject, "created_at": t.created_at}
                           for t in pressured.order_by("-created_at")[:10]],
                "what_it_catches": "Bundles, pooling or sponsored content creating confusion or pressure.",
            },
        })


class AdminDispatchFairnessView(APIView):
    """GET /api/admin/dispatch/fairness?days=7 — offers, acceptances and trips per driver."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        from collections import Counter

        from django.utils import timezone
        from drivers.models import Driver
        from trips.models import TripEvent

        days = min(int(request.query_params.get("days", 7)), 90)
        since = timezone.now() - timezone.timedelta(days=days)
        offers = Counter(
            e["payload"].get("driver_id")
            for e in TripEvent.objects.filter(event_type="offered_to_driver", created_at__gte=since).values("payload")
        )
        matched = Counter(
            e["payload"].get("driver_user_id")
            for e in TripEvent.objects.filter(event_type="matched", created_at__gte=since).values("payload")
        )
        from django.db.models import Count, Q, Sum

        done = Q(trips_as_driver__status=Trip.Status.COMPLETED, trips_as_driver__completed_at__gte=since)
        rows = []
        # One query for every driver's trip count and fares (was two queries per driver).
        for d in Driver.objects.filter(verification_status="verified").select_related("user").annotate(
            completed=Count("trips_as_driver", filter=done), fares=Sum("trips_as_driver__fare_final", filter=done),
        ):
            uid = str(d.user_id)
            rows.append({
                "driver_id": str(d.id), "name": d.user.name or d.user.phone,
                "offers": offers.get(uid, 0), "accepted": matched.get(uid, 0),
                "completed_trips": d.completed,
                "earnings": str(d.fares or 0),
            })
        rows.sort(key=lambda r: -r["completed_trips"])
        counts = [r["completed_trips"] for r in rows]
        total = sum(counts)
        top_n = max(1, round(len(rows) * 0.2)) if rows else 0
        top_share = (sum(counts[:top_n]) / total) if total else 0

        fair_offers = [e["payload"] for e in TripEvent.objects.filter(
            event_type="offered_to_driver", created_at__gte=since, payload__has_key="fair_queue",
        ).values("payload")]
        fair = [p for p in fair_offers if p.get("fair_queue")]
        return Response({
            "days": days, "drivers": rows,
            "summary": {
                "drivers": len(rows), "completed_trips": total,
                "top_20_percent_share": round(top_share, 3),
                "drivers_with_no_trips": sum(1 for c in counts if c == 0),
                # PRD WR-20 success metric: concentration of work across drivers.
                "gini": _gini(counts),
                "p90_p10_ratio": _p90_p10(counts),
                # PRD WR-20 guardrail: measure the pickup-distance cost of the fairness floor.
                "fair_queue_offers": len(fair),
                "fair_queue_share_of_offers": round(len(fair) / len(fair_offers), 3) if fair_offers else 0,
                "fair_queue_avg_extra_km": round(sum(p.get("extra_km", 0) for p in fair) / len(fair), 3) if fair else 0,
            },
        })
