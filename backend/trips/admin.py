from django.contrib import admin

from trips.models import FareQuote, Rating, Trip, TripEvent


class TripEventInline(admin.TabularInline):
    model = TripEvent
    extra = 0
    readonly_fields = ["event_type", "payload", "created_at"]
    can_delete = False


class FareQuoteInline(admin.StackedInline):
    model = FareQuote
    extra = 0


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ["id", "passenger", "driver", "zone", "status", "requested_at", "fare_final"]
    list_filter = ["status", "zone"]
    search_fields = ["passenger__phone", "driver__user__phone"]
    inlines = [FareQuoteInline, TripEventInline]
    readonly_fields = ["requested_at", "matched_at", "started_at", "completed_at"]


@admin.register(Rating)
class RatingAdmin(admin.ModelAdmin):
    list_display = ["trip", "rater", "rated", "score", "created_at"]
    list_filter = ["score"]
