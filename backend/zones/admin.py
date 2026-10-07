from django.contrib import admin

from zones.models import PickupPoint, Place, ServiceZone


class PickupPointInline(admin.TabularInline):
    model = PickupPoint
    extra = 0


@admin.register(ServiceZone)
class ServiceZoneAdmin(admin.ModelAdmin):
    list_display = ["name", "base_fare", "per_km_rate", "active"]
    inlines = [PickupPointInline]


@admin.register(PickupPoint)
class PickupPointAdmin(admin.ModelAdmin):
    list_display = ["name", "zone", "is_campus_point"]
    list_filter = ["zone", "is_campus_point"]


@admin.register(Place)
class PlaceAdmin(admin.ModelAdmin):
    list_display = ["name", "area", "zone", "popularity", "is_active"]
    list_editable = ["popularity", "is_active"]
    list_filter = ["zone", "is_active"]
    search_fields = ["name", "aliases", "area"]
