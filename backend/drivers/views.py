from django.db.models import Sum
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from drivers.models import Driver
from drivers.serializers import (
    DriverApplicationSerializer,
    DriverSerializer,
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
        return Response(DriverSerializer(driver).data, status=status.HTTP_201_CREATED)


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
        data = DriverSerializer(driver).data
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
        return Response(DriverSerializer(driver).data)


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
