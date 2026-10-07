from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from core import storage
from drivers.models import Driver, Vehicle, normalize_ghana_card


def _ghana_card(value):
    try:
        return normalize_ghana_card(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.messages[0]) from exc


class PrivateFileField(serializers.URLField):
    """A link to a document in the private bucket. Output: always a fresh short-lived signed link, so a
    stored address is never exposed as-is. Input: a signed link the API handed out is saved as its plain
    address, so an expiring URL never ends up in the database."""

    def to_representation(self, value):
        return storage.sign(super().to_representation(value))

    def to_internal_value(self, data):
        return storage.canonicalize(super().to_internal_value(data))


def _doc():
    return PrivateFileField(required=False, allow_blank=True)


class VehicleSerializer(serializers.ModelSerializer):
    registration_document = _doc()
    roadworthy_certificate = _doc()

    class Meta:
        model = Vehicle
        fields = ["id", "plate_number", "vehicle_type", "registration_document", "photo",
                  "roadworthy_certificate", "roadworthy_expiry", "active"]
        read_only_fields = ["id"]


class DriverApplicationSerializer(serializers.Serializer):
    """POST /api/drivers/apply — PRD Section 4.2, verification gate WR-07.2."""

    licence_number = serializers.CharField(max_length=50)
    licence_expiry = serializers.DateField(required=False)
    licence_document = _doc()
    # LI 2519 requirements for a commercial rider.
    ghana_card_number = serializers.CharField(max_length=20)
    ghana_card_document = _doc()
    # Optional: collected when the rider has them; they don't block verification.
    transport_union = serializers.CharField(max_length=120, required=False, allow_blank=True)
    union_membership_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    union_card_document = _doc()
    roadworthy_certificate = _doc()
    roadworthy_expiry = serializers.DateField(required=False, allow_null=True)
    emergency_contact_name = serializers.CharField(required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(required=False, allow_blank=True)
    # Optional: left blank, payouts go to the account phone by MoMo (see Driver.payout_destination).
    payout_phone = serializers.CharField(required=False, allow_blank=True)
    payout_provider = serializers.ChoiceField(choices=["momo", "hubtel"], required=False)
    plate_number = serializers.CharField(max_length=20)
    vehicle_photo = serializers.URLField(required=False, allow_blank=True)
    vehicle_registration_document = _doc()

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
    licence_document = _doc()
    union_card_document = _doc()

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
    ghana_card_document = _doc()

    class Meta(DriverSerializer.Meta):
        fields = [*DriverSerializer.Meta.fields, "ghana_card_number", "ghana_card_document", "compliance_missing"]

    def get_compliance_missing(self, obj):
        return obj.compliance_missing()


class DriverStatusSerializer(serializers.Serializer):
    """PATCH /api/drivers/me/status — availability toggle."""

    is_online = serializers.BooleanField()
    zone_id = serializers.UUIDField(required=False)
