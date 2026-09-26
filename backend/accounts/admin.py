from django.contrib import admin

from accounts.models import OTPRequest, RecurringRideSchedule, SavedAddress, StudentProfile, User


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


@admin.register(SavedAddress)
class SavedAddressAdmin(admin.ModelAdmin):
    list_display = ["user", "label", "usage_count", "last_used_at", "created_at"]
    search_fields = ["user__phone", "user__email", "label"]


@admin.register(RecurringRideSchedule)
class RecurringRideScheduleAdmin(admin.ModelAdmin):
    list_display = ["passenger", "pickup", "destination", "time_of_day", "active", "last_reminded_at"]
    list_filter = ["active"]
    search_fields = ["passenger__phone", "passenger__email"]
