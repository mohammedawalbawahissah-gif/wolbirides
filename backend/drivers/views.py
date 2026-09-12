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
        return Response(DriverSerializer(driver).data)


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
    """GET /api/drivers/me/trips"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from trips.models import Trip
        from trips.serializers import TripSerializer

        driver = get_object_or_404(Driver, user=request.user)
        trips = Trip.objects.filter(driver=driver).order_by("-requested_at")[:100]
        return Response(TripSerializer(trips, many=True).data)


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
