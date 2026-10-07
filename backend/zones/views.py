import uuid

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
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


class PlaceSearchView(APIView):
    """
    GET /api/places/search?q=citadel&zone=1&lat=9.40&lng=-0.84

    Type-as-you-type place search for the booking screen. Curated places and pickup points first, then an outside
    map service for what is still missing (zones/places.py). `zone` limits results to that service area; `lat`/`lng`
    (the passenger's position or map centre) help the outside service rank nearby results first.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "place_search"

    def get(self, request):
        from zones import places

        zone = None
        zone_id = request.query_params.get("zone")
        if zone_id:
            try:
                zone = ServiceZone.objects.filter(active=True, id=uuid.UUID(zone_id)).first()
            except (TypeError, ValueError):
                zone = None
        near = None
        try:
            lat, lng = float(request.query_params["lat"]), float(request.query_params["lng"])
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                near = (lat, lng)
        except (KeyError, TypeError, ValueError):
            pass
        return Response({"results": places.search(request.query_params.get("q", ""), zone, near)})
