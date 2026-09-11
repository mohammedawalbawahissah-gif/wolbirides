from django.contrib import admin

from drivers.models import Driver, Vehicle


class VehicleInline(admin.TabularInline):
    model = Vehicle
    extra = 0


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = [
        "user", "verification_status", "is_online", "current_zone",
        "quality_score", "licence_expiry",
    ]
    list_filter = ["verification_status", "is_online", "current_zone"]
    search_fields = ["user__phone", "user__name", "licence_number"]
    inlines = [VehicleInline]
    actions = ["mark_verified", "mark_suspended"]

    @admin.action(description="Mark selected drivers as verified")
    def mark_verified(self, request, queryset):
        queryset.update(verification_status=Driver.VerificationStatus.VERIFIED)

    @admin.action(description="Suspend selected drivers")
    def mark_suspended(self, request, queryset):
        queryset.update(verification_status=Driver.VerificationStatus.SUSPENDED, is_online=False)
