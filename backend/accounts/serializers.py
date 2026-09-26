from rest_framework import serializers

from accounts.models import RecurringRideSchedule, SavedAddress, StudentProfile, User


class EmailOTPRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class EmailSignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)
    password = serializers.CharField(min_length=8, write_only=True)

    def validate_password(self, value):
        # Same rules as password reset (Django's validators: length, common passwords, all-numeric).
        from django.contrib.auth.password_validation import validate_password

        validate_password(value)
        return value
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["passenger", "driver"], default="passenger")


class EmailLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "phone", "email", "name", "role", "otp_verified", "profile_photo",
            "emergency_contact_name", "emergency_contact_phone", "created_at",
        ]
        read_only_fields = ["id", "phone", "email", "role", "otp_verified", "created_at"]

    def validate_emergency_contact_phone(self, value):
        value = (value or "").strip()
        if not value:
            return ""
        from accounts.services import normalize_phone

        normalized = normalize_phone(value)
        if not normalized.startswith("+") or not normalized[1:].isdigit() or len(normalized) < 10:
            raise serializers.ValidationError("Enter a valid phone number, e.g. 024 123 4567.")
        return normalized


class SavedAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedAddress
        fields = ["id", "label", "lat", "lng", "address_text", "usage_count", "last_used_at", "created_at"]
        read_only_fields = ["id", "usage_count", "last_used_at", "created_at"]


class RecurringRideScheduleSerializer(serializers.ModelSerializer):
    pickup_detail = SavedAddressSerializer(source="pickup", read_only=True)
    destination_detail = SavedAddressSerializer(source="destination", read_only=True)

    class Meta:
        model = RecurringRideSchedule
        fields = [
            "id", "pickup", "destination", "pickup_detail", "destination_detail",
            "days_of_week", "time_of_day", "active", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_days_of_week(self, value):
        if not value or not all(isinstance(d, int) and 0 <= d <= 6 for d in value):
            raise serializers.ValidationError("days_of_week must be a non-empty list of integers 0-6 (Monday=0).")
        return sorted(set(value))

    def validate(self, attrs):
        pickup = attrs.get("pickup") or getattr(self.instance, "pickup", None)
        destination = attrs.get("destination") or getattr(self.instance, "destination", None)
        request = self.context.get("request")
        if pickup and request and pickup.user_id != request.user.id:
            raise serializers.ValidationError({"pickup": "Not one of your saved addresses."})
        if destination and request and destination.user_id != request.user.id:
            raise serializers.ValidationError({"destination": "Not one of your saved addresses."})
        if pickup and destination and pickup.id == destination.id:
            raise serializers.ValidationError("Pickup and destination can't be the same saved address.")
        return attrs


class SuggestedRideSerializer(serializers.Serializer):
    pickup_label = serializers.CharField()
    pickup_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    pickup_lng = serializers.DecimalField(max_digits=9, decimal_places=6)
    destination_label = serializers.CharField()
    destination_lat = serializers.DecimalField(max_digits=9, decimal_places=6)
    destination_lng = serializers.DecimalField(max_digits=9, decimal_places=6)
    trip_count = serializers.IntegerField()


class StudentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = StudentProfile
        fields = ["id", "user", "student_id_number", "verification_status", "home_zone"]
        read_only_fields = ["id", "verification_status"]
