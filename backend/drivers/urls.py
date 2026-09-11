from django.urls import path

from drivers.views import (
    DriverApplyView,
    DriverEarningsView,
    DriverMeView,
    DriverStatusView,
    DriverTripHistoryView,
)

urlpatterns = [
    path("drivers/apply", DriverApplyView.as_view(), name="driver-apply"),
    path("drivers/me", DriverMeView.as_view(), name="driver-me"),
    path("drivers/me/status", DriverStatusView.as_view(), name="driver-status"),
    path("drivers/me/trips", DriverTripHistoryView.as_view(), name="driver-trip-history"),
    path("drivers/me/earnings", DriverEarningsView.as_view(), name="driver-earnings"),
]
