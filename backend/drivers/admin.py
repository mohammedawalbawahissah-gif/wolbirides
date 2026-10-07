from django.contrib import admin, messages

from drivers.models import Driver, RiderPass, RiderPassPlan, Vehicle


class VehicleInline(admin.TabularInline):
    model = Vehicle
    extra = 0


class RiderPassInline(admin.TabularInline):
    model = RiderPass
    extra = 0
    fields = ["source", "status", "plan", "duration_days", "price_paid", "starts_at", "expires_at", "recorded_by"]
    readonly_fields = fields
    can_delete = False
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False  # record cash/grants through the admin API so they stack and notify correctly


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = [
        "user", "verification_status", "is_online", "current_zone",
        "quality_score", "licence_expiry", "transport_union",
    ]
    list_filter = ["verification_status", "is_online", "current_zone", "transport_union"]
    search_fields = ["user__phone", "user__name", "licence_number", "ghana_card_number", "union_membership_number"]
    inlines = [VehicleInline, RiderPassInline]
    actions = ["mark_verified", "mark_suspended"]

    @admin.action(description="Mark selected riders as verified (skips riders missing documents)")
    def mark_verified(self, request, queryset):
        done, skipped = 0, []
        for driver in queryset.prefetch_related("vehicles"):
            if driver.compliance_missing():
                skipped.append(str(driver))
                continue
            driver.verification_status = Driver.VerificationStatus.VERIFIED
            driver.save(update_fields=["verification_status", "updated_at"])
            done += 1
        self.message_user(request, f"Verified {done} rider(s).")
        if skipped:
            self.message_user(request, f"Missing documents, not verified: {', '.join(skipped)}", messages.WARNING)

    @admin.action(description="Suspend selected riders")
    def mark_suspended(self, request, queryset):
        queryset.update(verification_status=Driver.VerificationStatus.SUSPENDED, is_online=False)


@admin.register(RiderPassPlan)
class RiderPassPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "duration_days", "price", "active"]
    list_editable = ["price", "active"]


@admin.register(RiderPass)
class RiderPassAdmin(admin.ModelAdmin):
    list_display = ["driver", "source", "status", "plan", "price_paid", "starts_at", "expires_at"]
    list_filter = ["source", "status", "plan"]
    search_fields = ["driver__user__phone", "driver__user__name", "payment_reference"]
    readonly_fields = [f.name for f in RiderPass._meta.fields]

    def has_add_permission(self, request):
        return False
