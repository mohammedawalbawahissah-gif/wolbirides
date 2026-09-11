from rest_framework import serializers

from trips.models import FareQuote, Rating, Trip, TripEvent


class FareQuoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = FareQuote
        fields = ["distance_km", "base_fare", "per_km_charge", "total", "expires_at"]


class TripRequestSerializer(serializers.Serializer):
    """Input for POST /api/trips — PRD Section 7."""

    zone_id = serializers.UUIDField()
    pickup_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    pickup_lng = serializers.DecimalField(max_digits=9, decimal_places=6)
    pickup_label = serializers.CharField(required=False, allow_blank=True)
    destination_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    destination_lng = serializers.DecimalField(max_digits=9, decimal_places=6)
    destination_label = serializers.CharField(required=False, allow_blank=True)
    distance_km = serializers.DecimalField(max_digits=6, decimal_places=2)


class TripSerializer(serializers.ModelSerializer):
    fare_quote = FareQuoteSerializer(read_only=True)

    class Meta:
        model = Trip
        fields = [
            "id", "passenger", "driver", "zone", "status",
            "pickup_lat", "pickup_lng", "pickup_label",
            "destination_lat", "destination_lng", "destination_label",
            "fare_quote", "fare_final", "cancel_reason", "cancelled_by",
            "requested_at", "matched_at", "started_at", "completed_at",
        ]
        read_only_fields = fields


class TripCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class RatingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rating
        fields = ["id", "trip", "rater", "rated", "score", "issue_tags", "comment", "created_at"]
        read_only_fields = ["id", "rater", "created_at"]
