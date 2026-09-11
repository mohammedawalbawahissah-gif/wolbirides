from rest_framework import serializers

from payments.models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "trip", "method", "amount", "status", "provider_reference", "created_at"]
        read_only_fields = ["id", "status", "provider_reference", "created_at"]


class MomoInitiateSerializer(serializers.Serializer):
    trip_id = serializers.UUIDField()
    phone = serializers.CharField(max_length=20)


class MomoWebhookSerializer(serializers.Serializer):
    """
    Shape is intentionally provider-agnostic here — pin exact field names once
    WR-10.3's licensed payment partner is selected (PRD Section 12 open
    question). reference must match what was returned from initiate.
    """

    reference = serializers.CharField()
    status = serializers.ChoiceField(choices=["success", "failed"])
