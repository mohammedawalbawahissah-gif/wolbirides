from django.contrib import admin

from support.models import SupportTicket


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
    list_display = ["subject", "user", "category", "status", "assigned_to", "created_at"]
    list_filter = ["category", "status"]
    search_fields = ["subject", "user__phone"]
