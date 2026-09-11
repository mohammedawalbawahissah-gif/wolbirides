from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from zones.models import ServiceZone
from zones.serializers import ServiceZoneSerializer


class ZoneListView(APIView):
    """
    GET /api/zones — active zones only, for passenger/driver apps to pick
    from (e.g. zone selection on the ride-request screen). This is
    intentionally separate from /api/admin/zones, which is unfiltered and
    admin-only.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        zones = ServiceZone.objects.filter(active=True).prefetch_related("pickup_points")
        return Response(ServiceZoneSerializer(zones, many=True).data)
