from django.contrib import admin

from accounts.models import OTPRequest, StudentProfile, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ["phone", "name", "role", "otp_verified", "is_active", "created_at"]
    list_filter = ["role", "is_active", "otp_verified"]
    search_fields = ["phone", "name"]


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "student_id_number", "verification_status", "home_zone"]
    list_filter = ["verification_status"]


@admin.register(OTPRequest)
class OTPRequestAdmin(admin.ModelAdmin):
    list_display = ["phone", "expires_at", "consumed", "attempt_count", "created_at"]
    list_filter = ["consumed"]
