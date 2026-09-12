from rest_framework import serializers

from trips.models import FareQuote, Rating, Trip, TripEvent


class FareQuoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = FareQuote
        fields = ["distance_km", "base_fare", "per_km_charge", "total", "expires_at"]


class TripVehicleBriefSerializer(serializers.Serializer):
    """Minimal vehicle info for display on the passenger's trip screen."""

    plate_number = serializers.CharField()
    vehicle_type = serializers.CharField()
    photo = serializers.CharField(allow_blank=True)


class TripDriverBriefSerializer(serializers.Serializer):
    """
    Read-only, passenger-facing snapshot of the matched driver — deliberately
    thin (name, rating, active vehicle) rather than exposing the full Driver
    record, since this rides alongside the Trip payload on every poll/socket
    update.
    """

    id = serializers.UUIDField()
    name = serializers.CharField(source="user.name")
    phone = serializers.CharField(source="user.phone")
    profile_photo = serializers.CharField(source="user.profile_photo", allow_blank=True)
    rating = serializers.DecimalField(max_digits=4, decimal_places=2, source="quality_score")
    verification_status = serializers.CharField()
    vehicle = serializers.SerializerMethodField()
    current_lat = serializers.DecimalField(max_digits=9, decimal_places=6, allow_null=True)
    current_lng = serializers.DecimalField(max_digits=9, decimal_places=6, allow_null=True)

    def get_vehicle(self, driver):
        vehicle = driver.vehicles.filter(active=True).first()
        if not vehicle:
            return None
        return TripVehicleBriefSerializer(vehicle).data


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
    driver_detail = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id", "passenger", "driver", "driver_detail", "zone", "status",
            "pickup_lat", "pickup_lng", "pickup_label",
            "destination_lat", "destination_lng", "destination_label",
            "fare_quote", "fare_final", "cancel_reason", "cancelled_by",
            "requested_at", "matched_at", "started_at", "completed_at",
        ]
        read_only_fields = fields

    def get_driver_detail(self, trip):
        """Nested driver+vehicle snapshot for trust signals on the trip screen — None until matched."""
        if not trip.driver_id:
            return None
        return TripDriverBriefSerializer(trip.driver).data


class TripCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class RatingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Rating
        fields = ["id", "trip", "rater", "rated", "score", "issue_tags", "comment", "created_at"]
        read_only_fields = ["id", "rater", "created_at"]
