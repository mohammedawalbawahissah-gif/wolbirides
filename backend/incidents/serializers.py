from rest_framework import serializers

from incidents.models import Incident


class IncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = ["id", "trip", "reported_by", "severity", "status", "description", "resolved_at", "created_at"]
        read_only_fields = ["id", "reported_by", "status", "resolved_at", "created_at"]


class IncidentUpdateSerializer(serializers.Serializer):
    """Admin-only status transition — PRD Section 4.3."""

    status = serializers.ChoiceField(choices=Incident.Status.choices)
