from rest_framework import serializers

from payments.models import Payment, Payout


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "trip", "method", "funding_source", "amount", "status", "payer_phone", "failure_reason", "confirmed_by",
                  "created_at", "updated_at"]
        read_only_fields = fields


class PayoutSerializer(serializers.ModelSerializer):
    driver_name = serializers.CharField(source="driver.user.name", read_only=True)
    driver_phone = serializers.CharField(source="driver.user.phone", read_only=True)

    class Meta:
        model = Payout
        fields = [
            "id", "driver", "driver_name", "driver_phone", "period_start", "period_end", "amount", "status",
            "commission_rate_snapshot", "line_items", "provider_reference",
            "failure_reason", "retry_count", "created_at",
        ]
        read_only_fields = fields


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
