from django.urls import path

from drivers.views import DriverApplyView, DriverMeView, DriverStatusView

urlpatterns = [
    path("drivers/apply", DriverApplyView.as_view(), name="driver-apply"),
    path("drivers/me", DriverMeView.as_view(), name="driver-me"),
    path("drivers/me/status", DriverStatusView.as_view(), name="driver-status"),
]
