from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from drivers.models import Driver, Vehicle, normalize_ghana_card


def _ghana_card(value):
    try:
        return normalize_ghana_card(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.messages[0]) from exc


class VehicleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vehicle
        fields = ["id", "plate_number", "vehicle_type", "registration_document", "photo",
                  "roadworthy_certificate", "roadworthy_expiry", "active"]
        read_only_fields = ["id"]


class DriverApplicationSerializer(serializers.Serializer):
    """POST /api/drivers/apply — PRD Section 4.2, verification gate WR-07.2."""

    licence_number = serializers.CharField(max_length=50)
    licence_expiry = serializers.DateField(required=False)
    licence_document = serializers.URLField(required=False, allow_blank=True)
    # LI 2519 requirements for a commercial rider.
    ghana_card_number = serializers.CharField(max_length=20)
    ghana_card_document = serializers.URLField(required=False, allow_blank=True)
    # Optional: collected when the rider has them; they don't block verification.
    transport_union = serializers.CharField(max_length=120, required=False, allow_blank=True)
    union_membership_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    union_card_document = serializers.URLField(required=False, allow_blank=True)
    roadworthy_certificate = serializers.URLField(required=False, allow_blank=True)
    roadworthy_expiry = serializers.DateField(required=False, allow_null=True)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    # Optional: left blank, payouts go to the account phone by MoMo (see Driver.payout_destination).
    payout_phone = serializers.CharField(required=False, allow_blank=True)
    payout_provider = serializers.ChoiceField(choices=["momo", "hubtel"], required=False)
    plate_number = serializers.CharField(max_length=20)
    vehicle_photo = serializers.URLField(required=False, allow_blank=True)
    vehicle_registration_document = serializers.URLField(required=False, allow_blank=True)

    def validate_ghana_card_number(self, value):
        value = _ghana_card(value)
        request = self.context.get("request")
        taken = Driver.objects.filter(ghana_card_number=value)
        if request:
            taken = taken.exclude(user=request.user)
        if taken.exists():
            raise serializers.ValidationError("This Ghana Card is already registered to another rider.")
        return value

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
            raise serializers.ValidationError("This vehicle plate is already registered to another rider.")
        return value


class DriverSerializer(serializers.ModelSerializer):
    vehicles = VehicleSerializer(many=True, read_only=True)

    class Meta:
        model = Driver
        fields = [
            "id", "licence_number", "licence_expiry", "licence_document", "verification_status",
            "quality_score", "is_online", "current_zone", "vehicles",
            "offers_quiet_ride", "has_luggage_space", "accessibility_trained", "accepts_deliveries",
            "emergency_contact_name", "emergency_contact_phone", "payout_phone", "payout_provider",
            "transport_union", "union_membership_number", "union_card_document",
        ]
        read_only_fields = ["id", "verification_status", "quality_score"]


class DriverPrivateSerializer(DriverSerializer):
    """For the rider themself and for admins only: adds the Ghana Card, which is personal data and
    must not appear in anything a passenger or another rider can read."""

    compliance_missing = serializers.SerializerMethodField()

    class Meta(DriverSerializer.Meta):
        fields = [*DriverSerializer.Meta.fields, "ghana_card_number", "ghana_card_document", "compliance_missing"]

    def get_compliance_missing(self, obj):
        return obj.compliance_missing()


class DriverStatusSerializer(serializers.Serializer):
    """PATCH /api/drivers/me/status — availability toggle."""

    is_online = serializers.BooleanField()
    zone_id = serializers.UUIDField(required=False)
