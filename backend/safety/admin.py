from django.contrib import admin

from safety.models import SafetyCheckIn, TripShare

admin.site.register(TripShare)
admin.site.register(SafetyCheckIn)
