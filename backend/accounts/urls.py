from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import (
    AdminLoginView,
    DriverLoginView,
    EmailOTPRequestView,
    LoginView,
    MeView,
    RecurringRideScheduleDetailView,
    RecurringRideScheduleListView,
    SavedAddressDeleteView,
    SavedAddressListView,
    SignupView,
    SuggestedRideView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
)

urlpatterns = [
    path("auth/email/otp/request", EmailOTPRequestView.as_view(), name="email-otp-request"),
    path("auth/signup", SignupView.as_view(), name="signup"),
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/token/refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/password/reset/request", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("auth/password/reset/confirm", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("admin/auth/login", AdminLoginView.as_view(), name="admin-login"),
    path("drivers/auth/login", DriverLoginView.as_view(), name="driver-login"),
    path("passengers/me", MeView.as_view(), name="me"),
    path("passengers/me/addresses", SavedAddressListView.as_view(), name="saved-addresses"),
    path("passengers/me/addresses/<uuid:address_id>", SavedAddressDeleteView.as_view(), name="saved-address-delete"),
    path("passengers/me/suggested-ride", SuggestedRideView.as_view(), name="suggested-ride"),
    path("passengers/me/recurring-rides", RecurringRideScheduleListView.as_view(), name="recurring-rides"),
    path(
        "passengers/me/recurring-rides/<uuid:schedule_id>",
        RecurringRideScheduleDetailView.as_view(),
        name="recurring-ride-detail",
    ),
]
