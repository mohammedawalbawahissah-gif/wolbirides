from django.contrib import admin

from incidents.models import Incident


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ["severity", "status", "trip", "reported_by", "created_at", "resolved_at"]
    list_filter = ["severity", "status"]
    search_fields = ["description"]
