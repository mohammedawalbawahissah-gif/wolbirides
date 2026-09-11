from rest_framework import serializers

from accounts.models import StudentProfile, User


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.CharField(max_length=6)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "phone", "name", "role", "otp_verified", "created_at"]
        read_only_fields = ["id", "role", "otp_verified", "created_at"]


class StudentProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = StudentProfile
        fields = ["id", "user", "student_id_number", "verification_status", "home_zone"]
        read_only_fields = ["id", "verification_status"]
