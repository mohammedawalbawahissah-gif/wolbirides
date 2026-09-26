from rest_framework import serializers

from zones.models import PickupPoint, ServiceZone


class PickupPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupPoint
        fields = ["id", "name", "latitude", "longitude", "is_campus_point", "sponsor_name"]


class ServiceZoneSerializer(serializers.ModelSerializer):
    pickup_points = PickupPointSerializer(many=True, read_only=True)
    delivery_surcharge = serializers.SerializerMethodField()

    class Meta:
        model = ServiceZone
        fields = ["id", "name", "boundary", "base_fare", "per_km_rate", "active", "pickup_points", "delivery_surcharge", "pool_max_riders"]

    pool_max_riders = serializers.SerializerMethodField()

    def get_pool_max_riders(self, zone):
        from django.conf import settings

        return settings.POOL_MAX_RIDERS

    def get_delivery_surcharge(self, zone):
        from django.conf import settings

        return str(settings.DELIVERY_SURCHARGE)


class AdminServiceZoneSerializer(ServiceZoneSerializer):
    """Admin-only: adds the WR-18 escalation contact, which riders must never receive."""

    class Meta(ServiceZoneSerializer.Meta):
        fields = ServiceZoneSerializer.Meta.fields + ["security_contact_name", "security_contact_phone"]
