from django.contrib import admin

from payments.models import Payment, Payout


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["trip", "method", "amount", "status", "provider_reference", "created_at"]
    list_filter = ["method", "status"]


@admin.register(Payout)
class PayoutAdmin(admin.ModelAdmin):
    list_display = ["driver", "period_start", "period_end", "amount", "status", "commission_rate_snapshot", "retry_count"]
    list_filter = ["status"]
    readonly_fields = ["line_items"]
