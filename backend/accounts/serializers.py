from rest_framework import serializers

from accounts.models import SavedAddress, StudentProfile, User


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(max_length=6)


class EmailOTPRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class EmailSignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=6)
    password = serializers.CharField(min_length=8, write_only=True)
    name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=["passenger", "driver"], default="passenger")


class EmailLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "phone", "email", "name", "role", "otp_verified", "profile_photo", "created_at"]
        read_only_fields = ["id", "phone", "email", "role", "otp_verified", "created_at"]


class SavedAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedAddress
        fields = ["id", "label", "lat", "lng", "address_text", "created_at"]
        read_only_fields = ["id", "created_at"]


class StudentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = StudentProfile
        fields = ["id", "user", "student_id_number", "verification_status", "home_zone"]
        read_only_fields = ["id", "verification_status"]
