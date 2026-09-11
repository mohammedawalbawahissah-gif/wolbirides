"""
Cross-cutting admin endpoints (PRD Section 7 "Admin ops" group, and Section
4.3's Admin Dashboard requirements). Everything here requires IsAdminRole —
these are not exposed to passengers or drivers.
"""

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from drivers.models import Driver
from drivers.serializers import DriverSerializer
from incidents.models import Incident
from incidents.serializers import IncidentSerializer
from support.models import SupportTicket
from support.serializers import SupportTicketSerializer
from trips.models import Trip
from trips.serializers import TripSerializer
from zones.models import ServiceZone
from zones.serializers import ServiceZoneSerializer


class AdminZoneListView(APIView):
    """GET /api/admin/zones"""

    permission_classes = [IsAdminRole]

    def get(self, request):
        zones = ServiceZone.objects.all().prefetch_related("pickup_points")
        return Response(ServiceZoneSerializer(zones, many=True).data)


class AdminPendingDriversView(APIView):
    """GET /api/admin/drivers/pending — WR-07.2 verification queue."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        drivers = Driver.objects.filter(
            verification_status=Driver.VerificationStatus.PENDING
        ).select_related("user").prefetch_related("vehicles")
        return Response(DriverSerializer(drivers, many=True).data)


class AdminDriverVerifyView(APIView):
    """
    PATCH /api/admin/drivers/:id/verify
    Body: {"action": "verify" | "reject" | "suspend"}
    """

    permission_classes = [IsAdminRole]

    def patch(self, request, driver_id):
        driver = get_object_or_404(Driver, id=driver_id)
        action = request.data.get("action")
        mapping = {
            "verify": Driver.VerificationStatus.VERIFIED,
            "reject": Driver.VerificationStatus.REJECTED,
            "suspend": Driver.VerificationStatus.SUSPENDED,
        }
        if action not in mapping:
            return Response({"detail": "action must be one of verify/reject/suspend"}, status=400)
        driver.verification_status = mapping[action]
        if action != "verify":
            driver.is_online = False
        driver.save(update_fields=["verification_status", "is_online", "updated_at"])

        from core.models import AuditLog

        AuditLog.objects.create(
            actor=request.user, action=f"driver.{action}", target_model="Driver", target_id=str(driver.id)
        )
        return Response(DriverSerializer(driver).data)


class AdminTripSearchView(APIView):
    """
    GET /api/admin/trips?status=&zone=&passenger_phone=
    Simple filterable list for the admin trip-search + reconciliation view
    (PRD Section 4.3). Pagination is DRF's default (see REST_FRAMEWORK
    settings) — this view returns the raw queryset through that.
    """

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = Trip.objects.select_related("fare_quote", "driver__user", "passenger").order_by("-requested_at")
        status_param = request.query_params.get("status")
        zone_param = request.query_params.get("zone")
        phone_param = request.query_params.get("passenger_phone")
        if status_param:
            qs = qs.filter(status=status_param)
        if zone_param:
            qs = qs.filter(zone_id=zone_param)
        if phone_param:
            qs = qs.filter(passenger__phone__icontains=phone_param)
        return Response(TripSerializer(qs[:200], many=True).data)


class AdminIncidentListView(APIView):
    """GET /api/admin/incidents?status=&severity="""

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = Incident.objects.select_related("trip", "reported_by").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        if request.query_params.get("severity"):
            qs = qs.filter(severity=request.query_params["severity"])
        return Response(IncidentSerializer(qs[:200], many=True).data)


class AdminSupportTicketListView(APIView):
    """GET /api/admin/support/tickets?status="""

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = SupportTicket.objects.select_related("user").order_by("-created_at")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(SupportTicketSerializer(qs[:200], many=True).data)


class AdminDashboardSummaryView(APIView):
    """
    GET /api/admin/dashboard/summary
    Lightweight version of the WR-06.4 KPI set, computed on read rather
    than via a dedicated analytics pipeline — fine at pilot volume
    (WR-11's 1,000-ride learning milestone); revisit if query cost grows.
    """

    permission_classes = [IsAdminRole]

    def get(self, request):
        today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        trips_today = Trip.objects.filter(requested_at__gte=today_start)
        total_today = trips_today.count()
        completed_today = trips_today.filter(status=Trip.Status.COMPLETED).count()
        cancelled_today = trips_today.filter(status=Trip.Status.CANCELLED).count()

        return Response({
            "drivers_online": Driver.objects.filter(is_online=True).count(),
            "drivers_pending_verification": Driver.objects.filter(
                verification_status=Driver.VerificationStatus.PENDING
            ).count(),
            "trips_today": total_today,
            "trips_completed_today": completed_today,
            "trips_cancelled_today": cancelled_today,
            "cancellation_rate_today": round(cancelled_today / total_today, 3) if total_today else None,
            "open_incidents": Incident.objects.exclude(status=Incident.Status.RESOLVED).count(),
            "open_incidents_by_severity": dict(
                Incident.objects.exclude(status=Incident.Status.RESOLVED)
                .values_list("severity")
                .annotate(count=Count("id"))
            ),
            "open_support_tickets": SupportTicket.objects.exclude(status=SupportTicket.Status.RESOLVED).count(),
        })
