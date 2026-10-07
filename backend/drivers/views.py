from django.db.models import Sum
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core import storage
from drivers.models import Driver
from drivers.serializers import (
    DriverApplicationSerializer,
    DriverPrivateSerializer,
    DriverStatusSerializer,
)
from drivers.services import set_driver_online, submit_driver_application
from zones.models import ServiceZone


class DriverApplyView(APIView):
    """POST /api/drivers/apply"""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DriverApplicationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        driver = submit_driver_application(request.user, serializer.validated_data)
        return Response(DriverPrivateSerializer(driver).data, status=status.HTTP_201_CREATED)


class DriverMeView(APIView):
    """GET /api/drivers/me"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        driver = get_object_or_404(Driver, user=request.user)
        return Response(self._with_private(driver))

    @staticmethod
    def _with_private(driver):
        # WR-19: gender is self-reported, optional, and used only by matching. It's returned to
        # the driver themself here and nowhere else (not in admin lists or passenger views).
        data = DriverPrivateSerializer(driver).data
        data["gender"] = driver.gender
        return data

    def patch(self, request):
        """WR-19/23: drivers set what they offer, and where they're paid. Only these fields
        are editable here."""
        driver = get_object_or_404(Driver, user=request.user)
        editable = ("offers_quiet_ride", "has_luggage_space", "accessibility_trained", "accepts_deliveries")
        for field in editable:
            if field in request.data:
                setattr(driver, field, bool(request.data[field]))
        touched = [*editable]
        if "gender" in request.data:
            if request.data["gender"] not in ("", "female", "male"):
                return Response({"detail": "gender must be '', 'female' or 'male'."}, status=400)
            driver.gender = request.data["gender"]
            touched.append("gender")
        if "payout_provider" in request.data:
            if request.data["payout_provider"] not in ("momo", "hubtel"):
                return Response({"detail": "payout_provider must be 'momo' or 'hubtel'."}, status=400)
            driver.payout_provider = request.data["payout_provider"]
            touched.append("payout_provider")
        # LI 2519 details can be completed or corrected after applying (e.g. a rider who joined
        # the union later). Editing them doesn't reset verification; re-applying does.
        if "ghana_card_number" in request.data:
            from drivers.serializers import _ghana_card
            from rest_framework.exceptions import ValidationError as DRFValidationError

            try:
                value = _ghana_card(request.data["ghana_card_number"])
            except DRFValidationError as exc:
                return Response({"ghana_card_number": exc.detail}, status=400)
            if Driver.objects.filter(ghana_card_number=value).exclude(id=driver.id).exists():
                return Response({"ghana_card_number": ["This Ghana Card is already registered to another rider."]},
                                status=400)
            driver.ghana_card_number = value
            touched.append("ghana_card_number")
        for field, limit in (("transport_union", 120), ("union_membership_number", 50)):
            if field in request.data:
                value = (request.data[field] or "").strip()
                if len(value) > limit:
                    return Response({field: [f"At most {limit} characters."]}, status=400)
                setattr(driver, field, value)
                touched.append(field)
        for field in ("ghana_card_document", "union_card_document"):
            if field in request.data:
                value = (request.data[field] or "").strip()
                if value and not value.startswith("https://"):
                    return Response({field: ["Must be an https link to the uploaded document."]}, status=400)
                setattr(driver, field, storage.canonicalize(value))
                touched.append(field)
        # The active vehicle's roadworthy certificate is renewed yearly, so riders update it here.
        if "roadworthy_expiry" in request.data or "roadworthy_certificate" in request.data:
            vehicle = driver.vehicles.filter(active=True).first()
            if vehicle is None:
                return Response({"detail": "No active vehicle on your account."}, status=400)
            if "roadworthy_expiry" in request.data:
                from rest_framework import serializers as drf

                raw = request.data["roadworthy_expiry"]
                try:
                    vehicle.roadworthy_expiry = drf.DateField().to_internal_value(raw) if raw else None
                except drf.ValidationError:
                    return Response({"roadworthy_expiry": ["Use a date like 2027-06-30."]}, status=400)
            if "roadworthy_certificate" in request.data:
                value = (request.data["roadworthy_certificate"] or "").strip()
                if value and not value.startswith("https://"):
                    return Response({"roadworthy_certificate": ["Must be an https link to the uploaded document."]},
                                    status=400)
                vehicle.roadworthy_certificate = storage.canonicalize(value)
            vehicle.save(update_fields=["roadworthy_expiry", "roadworthy_certificate", "updated_at"])
        if "payout_phone" in request.data:
            from drivers.services import _normalize

            raw = (request.data["payout_phone"] or "").strip()
            driver.payout_phone = _normalize(raw) if raw else ""
            touched.append("payout_phone")
        driver.save(update_fields=[*touched, "updated_at"])
        return Response(self._with_private(driver))


class DriverStatusView(APIView):
    """PATCH /api/drivers/me/status — availability toggle, PRD Section 4.2."""

    permission_classes = [IsAuthenticated]

    def patch(self, request):
        driver = get_object_or_404(Driver, user=request.user)
        serializer = DriverStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        zone = None
        if serializer.validated_data.get("zone_id"):
            zone = get_object_or_404(ServiceZone, id=serializer.validated_data["zone_id"])
        try:
            driver = set_driver_online(driver, serializer.validated_data["is_online"], zone)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(DriverPrivateSerializer(driver).data)


class DriverTripHistoryView(APIView):
    """GET /api/drivers/me/trips[?before=<iso datetime>] — paged 50 at a time."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from trips.serializers import TripSerializer

        driver = get_object_or_404(Driver, user=request.user)
        from trips.services import history_page, trip_list_queryset

        trips = history_page(trip_list_queryset(request.user).filter(driver=driver), request)
        return Response(TripSerializer(trips, many=True, context={"request": request}).data)


class DriverEarningsView(APIView):
    """
    GET /api/drivers/me/earnings
    Simple on-read aggregation, matching the same "fine at pilot volume"
    reasoning as adminapi's dashboard summary — a dedicated Payout ledger
    (see payments/models.py) is the Phase 2 version of this once payout
    batching (WR-07.4 economics experiments) is actually running.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.utils import timezone

        from trips.models import Trip

        driver = get_object_or_404(Driver, user=request.user)
        completed = Trip.objects.filter(driver=driver, status=Trip.Status.COMPLETED)
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

        return Response({
            "trips_completed_total": completed.count(),
            "earnings_total": str(completed.aggregate(total=Sum("fare_final"))["total"] or 0),
            "trips_completed_today": completed.filter(completed_at__gte=today_start).count(),
            "earnings_today": str(
                completed.filter(completed_at__gte=today_start).aggregate(total=Sum("fare_final"))["total"] or 0
            ),
        })


class RiderPassView(APIView):
    """GET /api/drivers/me/passes — pass status, plans on sale, recent passes.
    POST {plan_id, phone?} — buy a pass by MoMo (phone defaults to the payout number)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from drivers.passes import pass_status

        driver = get_object_or_404(Driver, user=request.user)
        return Response(pass_status(driver))

    def post(self, request):
        from drivers.models import RiderPassPlan
        from drivers.passes import PassError, serialize_pass, start_purchase
        from drivers.services import _normalize

        driver = get_object_or_404(Driver, user=request.user)
        plan = RiderPassPlan.objects.filter(id=request.data.get("plan_id")).first() \
            if _is_uuid(request.data.get("plan_id")) else None
        if plan is None:
            return Response({"detail": "Choose a pass."}, status=400)
        raw = (request.data.get("phone") or "").strip()
        phone = _normalize(raw) if raw else driver.payout_destination()[0]
        try:
            rider_pass = start_purchase(driver, plan, phone)
        except PassError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(serialize_pass(rider_pass), status=status.HTTP_201_CREATED)


class RiderPassRefreshView(APIView):
    """POST /api/drivers/me/passes/<id>/refresh — check whether the MoMo payment went through."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pass_id):
        from drivers.models import RiderPass
        from drivers.passes import refresh_purchase, serialize_pass

        rider_pass = get_object_or_404(RiderPass, id=pass_id, driver__user=request.user)
        return Response(serialize_pass(refresh_purchase(rider_pass)))


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False
