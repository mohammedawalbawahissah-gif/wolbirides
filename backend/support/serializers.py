from rest_framework import serializers

from support.models import SupportTicket


class SupportTicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportTicket
        fields = ["id", "user", "category", "status", "subject", "description", "assigned_to", "created_at"]
        read_only_fields = ["id", "user", "status", "assigned_to", "created_at"]
