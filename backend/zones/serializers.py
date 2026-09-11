from rest_framework import serializers

from zones.models import PickupPoint, ServiceZone


class PickupPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupPoint
        fields = ["id", "name", "latitude", "longitude", "is_campus_point"]


class ServiceZoneSerializer(serializers.ModelSerializer):
    pickup_points = PickupPointSerializer(many=True, read_only=True)

    class Meta:
        model = ServiceZone
        fields = ["id", "name", "boundary", "base_fare", "per_km_rate", "active", "pickup_points"]
