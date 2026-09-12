"""
Cross-cutting admin endpoints (PRD Section 7 "Admin ops" group, and Section
4.3's Admin Dashboard requirements). Everything here requires IsAdminRole —
these are not exposed to passengers or drivers.
"""

from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta
from decimal import Decimal
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
    """GET/POST /api/admin/zones — create form was previously Django-admin-only."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        zones = ServiceZone.objects.all().prefetch_related("pickup_points")
        return Response(ServiceZoneSerializer(zones, many=True).data)

    def post(self, request):
        serializer = ServiceZoneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=201)


class AdminZoneDetailView(APIView):
    """PATCH/DELETE /api/admin/zones/<id>"""

    permission_classes = [IsAdminRole]

    def patch(self, request, zone_id):
        try:
            zone = ServiceZone.objects.get(id=zone_id)
        except ServiceZone.DoesNotExist:
            return Response({"detail": "Not found"}, status=404)
        serializer = ServiceZoneSerializer(zone, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, zone_id):
        deleted, _ = ServiceZone.objects.filter(id=zone_id).delete()
        if not deleted:
            return Response({"detail": "Not found"}, status=404)
        return Response(status=204)


class AdminPendingDriversView(APIView):
    """GET /api/admin/drivers/pending — WR-07.2 verification queue."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        drivers = Driver.objects.filter(
            verification_status=Driver.VerificationStatus.PENDING
        ).select_related("user").prefetch_related("vehicles")
        return Response(DriverSerializer(drivers, many=True).data)


class AdminDriverListView(APIView):
    """GET /api/admin/drivers — full directory, optionally filtered by status/search."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        drivers = Driver.objects.select_related("user").prefetch_related("vehicles").order_by("-created_at")
        status_param = request.query_params.get("status")
        search = request.query_params.get("search")
        if status_param:
            drivers = drivers.filter(verification_status=status_param)
        if search:
            drivers = drivers.filter(
                Q(user__name__icontains=search)
                | Q(user__phone__icontains=search)
                | Q(licence_number__icontains=search)
            )
        return Response(DriverSerializer(drivers[:200], many=True).data)


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

        from core.models import AuditLog, notify

        AuditLog.objects.create(
            actor=request.user, action=f"driver.{action}", target_model="Driver", target_id=str(driver.id)
        )

        notify_copy = {
            "verify": ("You're verified!", "Ops approved your documents — you can go online now."),
            "reject": ("Application not approved", "Ops couldn't verify your documents. Contact support for next steps."),
            "suspend": ("Account suspended", "Your driver account has been suspended pending review."),
        }
        title, body = notify_copy[action]
        notify(driver.user, title, body, category="driver", link="/profile")

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
        from_param = request.query_params.get("from")
        to_param = request.query_params.get("to")
        if status_param:
            qs = qs.filter(status=status_param)
        if zone_param:
            qs = qs.filter(zone_id=zone_param)
        if phone_param:
            qs = qs.filter(passenger__phone__icontains=phone_param)
        if from_param:
            qs = qs.filter(requested_at__date__gte=from_param)
        if to_param:
            qs = qs.filter(requested_at__date__lte=to_param)
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


class AdminDashboardTrendsView(APIView):
    """
    GET /api/admin/dashboard/trends — daily trip volume and completed-fare
    revenue for the last 14 days, so the Overview page can chart a trend
    instead of only showing today's snapshot numbers.
    """

    permission_classes = [IsAdminRole]

    def get(self, request):
        days = 14
        today = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
        start = today - timedelta(days=days - 1)

        trips = Trip.objects.filter(requested_at__gte=start)
        buckets = {(start + timedelta(days=i)).date(): {"date": (start + timedelta(days=i)).date().isoformat(), "requested": 0, "completed": 0, "cancelled": 0, "revenue": Decimal("0")} for i in range(days)}

        for trip in trips.only("requested_at", "status", "fare_final"):
            key = timezone.localtime(trip.requested_at).date()
            bucket = buckets.get(key)
            if not bucket:
                continue
            bucket["requested"] += 1
            if trip.status == Trip.Status.COMPLETED:
                bucket["completed"] += 1
                if trip.fare_final:
                    bucket["revenue"] += trip.fare_final
            elif trip.status == Trip.Status.CANCELLED:
                bucket["cancelled"] += 1

        series = sorted(buckets.values(), key=lambda b: b["date"])
        for b in series:
            b["revenue"] = str(b["revenue"])
        return Response(series)


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
