from django.urls import path

from accounts.views import AdminOTPVerifyView, MeView, OTPRequestView, OTPVerifyView

urlpatterns = [
    path("auth/otp/request", OTPRequestView.as_view(), name="otp-request"),
    path("auth/otp/verify", OTPVerifyView.as_view(), name="otp-verify"),
    path("admin/auth/otp/verify", AdminOTPVerifyView.as_view(), name="admin-otp-verify"),
    path("passengers/me", MeView.as_view(), name="me"),
]
