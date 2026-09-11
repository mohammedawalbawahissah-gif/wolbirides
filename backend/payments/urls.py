from django.urls import path

from payments.views import MomoInitiateView, MomoWebhookView

urlpatterns = [
    path("payments/momo/initiate", MomoInitiateView.as_view(), name="momo-initiate"),
    path("payments/momo/webhook", MomoWebhookView.as_view(), name="momo-webhook"),
]
