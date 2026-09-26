from rest_framework import serializers

from incidents.models import Incident


class IncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = [
            "id", "trip", "reported_by", "severity", "status", "description", "resolved_at",
            "trigger_source", "is_sos", "location_lat", "location_lng", "created_at",
        ]
        read_only_fields = ["id", "reported_by", "status", "resolved_at", "trigger_source", "is_sos",
                            "location_lat", "location_lng", "created_at"]

    is_sos = serializers.SerializerMethodField()

    def get_is_sos(self, incident):
        return incident.trigger_source == Incident.TriggerSource.SOS_BUTTON


class IncidentUpdateSerializer(serializers.Serializer):
    """Admin-only status transition — PRD Section 4.3."""

    status = serializers.ChoiceField(choices=Incident.Status.choices)


class SOSSerializer(serializers.Serializer):
    lat = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    lng = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)
