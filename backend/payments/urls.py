from django.urls import path

from payments.views import (
    AdminPayoutApproveView,
    AdminPayoutBatchListView,
    AdminPayoutGenerateView,
    CashConfirmView,
    DriverPayoutListView,
    MomoInitiateView,
    MomoWebhookView,
    TripPaymentView,
)

urlpatterns = [
    path("payments/momo/initiate", MomoInitiateView.as_view(), name="momo-initiate"),
    path("payments/momo/webhook", MomoWebhookView.as_view(), name="momo-webhook"),
    path("payments/trip/<uuid:trip_id>", TripPaymentView.as_view(), name="trip-payment"),
    path("payments/cash/confirm", CashConfirmView.as_view(), name="cash-confirm"),
    path("drivers/me/payouts", DriverPayoutListView.as_view(), name="driver-payouts"),
    path("admin/payouts/batches", AdminPayoutBatchListView.as_view(), name="admin-payout-batches"),
    path("admin/payouts/batches/generate", AdminPayoutGenerateView.as_view(), name="admin-payout-generate"),
    path("admin/payouts/batches/<uuid:payout_id>/approve", AdminPayoutApproveView.as_view(), name="admin-payout-approve"),
]
