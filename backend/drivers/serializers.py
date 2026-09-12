from rest_framework import serializers

from drivers.models import Driver, Vehicle


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = ["id", "plate_number", "vehicle_type", "registration_document", "photo", "active"]
        read_only_fields = ["id"]


class DriverApplicationSerializer(serializers.Serializer):
    """POST /api/drivers/apply — PRD Section 4.2, verification gate WR-07.2."""

    licence_number = serializers.CharField(max_length=50)
    licence_expiry = serializers.DateField(required=False)
    licence_document = serializers.URLField(required=False, allow_blank=True)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    plate_number = serializers.CharField(max_length=20)
    vehicle_photo = serializers.URLField(required=False, allow_blank=True)
    vehicle_registration_document = serializers.URLField(required=False, allow_blank=True)

    def validate_plate_number(self, value):
        """
        Vehicle.plate_number is unique at the DB level (a plate can't belong
        to two drivers) — without this check, resubmitting a demo/test plate
        already tied to a different driver hits an IntegrityError and
        surfaces as a raw 500 instead of a message the applicant can act on.
        """
        request = self.context.get("request")
        existing = Vehicle.objects.filter(plate_number=value)
        if request:
            existing = existing.exclude(driver__user=request.user)
        if existing.exists():
            raise serializers.ValidationError("This vehicle plate is already registered to another driver.")
        return value


class DriverSerializer(serializers.ModelSerializer):
    vehicles = VehicleSerializer(many=True, read_only=True)

    class Meta:
        model = Driver
        fields = [
            "id", "licence_number", "licence_expiry", "verification_status",
            "quality_score", "is_online", "current_zone", "vehicles",
        ]
        read_only_fields = ["id", "verification_status", "quality_score"]


class DriverStatusSerializer(serializers.Serializer):
    """PATCH /api/drivers/me/status — availability toggle."""

    is_online = serializers.BooleanField()
    zone_id = serializers.UUIDField(required=False)
