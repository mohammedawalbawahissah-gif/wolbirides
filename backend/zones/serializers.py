from rest_framework import serializers

from zones.models import PickupPoint, ServiceZone


class PickupPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = PickupPoint
        fields = ["id", "name", "latitude", "longitude", "is_campus_point", "sponsor_name"]


class ServiceZoneSerializer(serializers.ModelSerializer):
    pickup_points = PickupPointSerializer(many=True, read_only=True)
    delivery_surcharge = serializers.SerializerMethodField()
    delivery_surcharges = serializers.SerializerMethodField()

    class Meta:
        model = ServiceZone
        fields = [
            "id", "name", "boundary", "base_fare", "per_km_rate", "active", "pickup_points",
            "delivery_surcharge", "delivery_surcharges", "pool_max_passengers",
        ]

    pool_max_passengers = serializers.SerializerMethodField()

    def get_pool_max_passengers(self, zone):
        from django.conf import settings

        return settings.POOL_MAX_PASSENGERS

    def get_delivery_surcharge(self, zone):
        from django.conf import settings

        # WR-25: kept for existing web/mobile clients that read this as one flat number
        # (Number(zone.delivery_surcharge)) — equals the small-parcel tier, which is what
        # the old flat DELIVERY_SURCHARGE amounted to before pricing split by size/subtype.
        # New clients should read delivery_surcharges instead, which has the real breakdown.
        return str(settings.DELIVERY_SURCHARGE_BY_SIZE["small"])

    def get_delivery_surcharges(self, zone):
        from django.conf import settings

        by_size = settings.DELIVERY_SURCHARGE_BY_SIZE
        return {
            "parcel_small": str(by_size["small"]),
            "parcel_medium": str(by_size["medium"]),
            "parcel_large": str(by_size["large"]),
            "task": str(settings.DELIVERY_TASK_SURCHARGE),  # errand / vendor_order
        }


class AdminServiceZoneSerializer(ServiceZoneSerializer):
    """Admin-only: adds the WR-18 escalation contact, which passengers must never receive."""

    class Meta(ServiceZoneSerializer.Meta):
        fields = ServiceZoneSerializer.Meta.fields + ["security_contact_name", "security_contact_phone"]
