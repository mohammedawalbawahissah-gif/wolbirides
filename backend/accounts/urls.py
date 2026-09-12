from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import (
    AdminLoginView,
    AdminOTPVerifyView,
    EmailOTPRequestView,
    LoginView,
    MeView,
    OTPRequestView,
    OTPVerifyView,
    SavedAddressDeleteView,
    SavedAddressListView,
    SignupView,
)

urlpatterns = [
    path("auth/otp/request", OTPRequestView.as_view(), name="otp-request"),
    path("auth/otp/verify", OTPVerifyView.as_view(), name="otp-verify"),
    path("auth/email/otp/request", EmailOTPRequestView.as_view(), name="email-otp-request"),
    path("auth/signup", SignupView.as_view(), name="signup"),
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/token/refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("admin/auth/otp/verify", AdminOTPVerifyView.as_view(), name="admin-otp-verify"),
    path("admin/auth/login", AdminLoginView.as_view(), name="admin-login"),
    path("passengers/me", MeView.as_view(), name="me"),
    path("passengers/me/addresses", SavedAddressListView.as_view(), name="saved-addresses"),
    path("passengers/me/addresses/<uuid:address_id>", SavedAddressDeleteView.as_view(), name="saved-address-delete"),
]
