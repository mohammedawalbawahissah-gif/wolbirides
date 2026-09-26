from rest_framework import serializers

from support.models import SupportTicket


class SupportTicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportTicket
        fields = ["id", "user", "category", "status", "subject", "description", "trip", "assigned_to",
                  "resolved_at", "created_at"]
        read_only_fields = ["id", "user", "status", "assigned_to", "resolved_at", "created_at"]

    def validate_trip(self, trip):
        request = self.context.get("request")
        if trip and request:
            from trips.services import user_can_access_trip

            if not user_can_access_trip(request.user, trip):
                raise serializers.ValidationError("You can only raise tickets about your own trips.")
        return trip
