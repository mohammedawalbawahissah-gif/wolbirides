from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
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

    permission_classes = [IsAdminRole]

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
