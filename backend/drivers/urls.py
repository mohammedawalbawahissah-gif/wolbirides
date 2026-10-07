from django.urls import path

from drivers.views import (
    DriverApplyView,
    DriverEarningsView,
    DriverMeView,
    DriverStatusView,
    DriverTripHistoryView,
    RiderPassRefreshView,
    RiderPassView,
)

urlpatterns = [
    path("drivers/apply", DriverApplyView.as_view(), name="driver-apply"),
    path("drivers/me", DriverMeView.as_view(), name="driver-me"),
    path("drivers/me/status", DriverStatusView.as_view(), name="driver-status"),
    path("drivers/me/trips", DriverTripHistoryView.as_view(), name="driver-trip-history"),
    path("drivers/me/earnings", DriverEarningsView.as_view(), name="driver-earnings"),
    path("drivers/me/passes", RiderPassView.as_view(), name="driver-passes"),
    path("drivers/me/passes/<uuid:pass_id>/refresh", RiderPassRefreshView.as_view(), name="driver-pass-refresh"),
]
