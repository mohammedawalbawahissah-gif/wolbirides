from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsStaffRole
from incidents.models import Incident
from incidents.serializers import IncidentSerializer, IncidentUpdateSerializer
from incidents.services import create_incident, resolve_incident
from trips.models import Trip


class IncidentCreateView(APIView):
    """POST /api/incidents — PRD Section 7."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = IncidentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trip = None
        if serializer.validated_data.get("trip"):
            trip = get_object_or_404(Trip, id=serializer.validated_data["trip"].id)
        incident = create_incident(
            reported_by=request.user,
            severity=serializer.validated_data["severity"],
            description=serializer.validated_data["description"],
            trip=trip,
        )
        return Response(IncidentSerializer(incident).data, status=status.HTTP_201_CREATED)


class IncidentUpdateView(APIView):
    """PATCH /api/incidents/:id — admin-only status transition."""

    permission_classes = [IsStaffRole]

    def patch(self, request, incident_id):
        incident = get_object_or_404(Incident, id=incident_id)
        serializer = IncidentUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data["status"] == Incident.Status.RESOLVED:
            incident = resolve_incident(incident)
        else:
            incident.status = serializer.validated_data["status"]
            incident.save(update_fields=["status", "updated_at"])
        return Response(IncidentSerializer(incident).data)


class TripSOSView(APIView):
    """POST /api/trips/:id/sos — WR-18. Passenger or driver on the trip only."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        from django.conf import settings

        from incidents.serializers import SOSSerializer
        from incidents.services import raise_sos

        trip = get_object_or_404(Trip, id=trip_id)
        is_passenger = trip.passenger_id == request.user.id
        is_driver = bool(trip.driver and trip.driver.user_id == request.user.id)
        if not (is_passenger or is_driver):
            return Response({"detail": "Not your trip."}, status=status.HTTP_403_FORBIDDEN)

        serializer = SOSSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        incident = raise_sos(
            trip, request.user,
            lat=serializer.validated_data.get("lat"),
            lng=serializer.validated_data.get("lng"),
            note=serializer.validated_data.get("note", ""),
        )
        return Response(
            {
                "incident_id": str(incident.id),
                "emergency_number": settings.SAFETY_EMERGENCY_NUMBER,
                "contact_notified": bool(request.user.emergency_contact_phone),
            },
            status=status.HTTP_201_CREATED,
        )


class TripCheckinView(APIView):
    """POST /api/trips/:id/checkin {response: "fine" | "something_off", details?} — WR-18 post-trip check-in.

    Separate from ratings, available to both the passenger and the driver after a completed trip.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        from incidents.services import post_trip_checkin

        trip = get_object_or_404(Trip, id=trip_id)
        is_party = trip.passenger_id == request.user.id or (trip.driver and trip.driver.user_id == request.user.id)
        if not is_party:
            return Response({"detail": "Not your trip."}, status=status.HTTP_403_FORBIDDEN)
        if trip.status != Trip.Status.COMPLETED:
            return Response({"detail": "The check-in opens after the trip ends."}, status=status.HTTP_409_CONFLICT)
        response = request.data.get("response")
        if response not in ("fine", "something_off"):
            return Response({"detail": "response must be 'fine' or 'something_off'."}, status=400)
        if trip.events.filter(event_type="post_trip_checkin", payload__by=(
                "driver" if trip.driver and trip.driver.user_id == request.user.id else "passenger")).exists():
            return Response({"detail": "Thanks, we already have your answer for this trip."}, status=200)
        incident = post_trip_checkin(trip, request.user, response, (request.data.get("details") or "")[:500])
        return Response({"recorded": True, "incident_id": str(incident.id) if incident else None})
