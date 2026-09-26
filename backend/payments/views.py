from core.throttling import ActionRateThrottle
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from payments.models import Payment, Payout
from payments.serializers import MomoInitiateSerializer, PaymentSerializer, PayoutSerializer
from payments.services import (
    PaymentError,
    handle_momo_callback,
    initiate_momo_payment,
    record_cash_payment,
    refresh_payment_status,
)
from trips.models import Trip
from trips.services import user_can_access_trip


class MomoInitiateView(APIView):
    """POST /api/payments/momo/initiate {trip_id, phone} — rider pays a completed trip by MoMo."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "momo_initiate"

    def post(self, request):
        serializer = MomoInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trip = get_object_or_404(Trip, id=serializer.validated_data["trip_id"])
        if trip.passenger_id != request.user.id:
            return Response({"detail": "Only the rider can pay for this trip."}, status=status.HTTP_403_FORBIDDEN)
        try:
            payment = initiate_momo_payment(trip, serializer.validated_data["phone"])
        except PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class TripPaymentView(APIView):
    """GET /api/payments/trip/<trip_id> — current payment, refreshed from MTN if pending (rider/driver poll this)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not user_can_access_trip(request.user, trip):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payment = Payment.objects.filter(trip=trip).first()
        if not payment:
            return Response(None)
        return Response(PaymentSerializer(refresh_payment_status(payment)).data)


class CashConfirmView(APIView):
    """POST /api/payments/cash/confirm {trip_id} — the driver confirms they received cash."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        trip = get_object_or_404(Trip, id=request.data.get("trip_id"))
        if not trip.driver or trip.driver.user_id != request.user.id:
            return Response({"detail": "Only this trip's driver can confirm cash."}, status=status.HTTP_403_FORBIDDEN)
        try:
            payment = record_cash_payment(trip, confirmed_by="driver")
        except PaymentError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(PaymentSerializer(payment).data)


class MomoWebhookView(APIView):
    """
    POST /api/payments/momo/webhook — MTN's callback for collections and
    disbursements. The body is only used to identify the transaction; the
    outcome is always re-read from MTN, so a forged callback can't mark
    anything as paid.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        reference_id = request.headers.get("X-Reference-Id") or request.data.get("referenceId") or ""
        external_id = request.data.get("externalId") or ""
        handle_momo_callback(reference_id=reference_id, external_id=external_id)
        return Response({"detail": "ok"})


class DriverPayoutListView(APIView):
    """GET /api/drivers/me/payouts — WR-14, itemized payout history."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not hasattr(request.user, "driver_profile"):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payouts = Payout.objects.filter(driver=request.user.driver_profile).order_by("-period_start")[:52]
        return Response(PayoutSerializer(payouts, many=True).data)


class AdminPayoutBatchListView(APIView):
    """GET /api/admin/payouts/batches?status= — WR-14 ops review queue."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        qs = Payout.objects.select_related("driver__user").order_by("-period_start")
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return Response(PayoutSerializer(qs[:200], many=True).data)


class AdminPayoutGenerateView(APIView):
    """
    POST /api/admin/payouts/batches/generate
    Body: {"period_start": "2026-09-01", "period_end": "2026-09-08"}
    Manual trigger for ops to (re-)generate a period's payouts outside the
    Monday-morning automatic sweep — e.g. to backfill a period, or re-run
    after fixing a data issue. Idempotent, same as the scheduled task.
    """

    permission_classes = [IsAdminRole]

    def post(self, request):
        from datetime import date

        from payments.services import generate_weekly_payouts

        try:
            period_start = date.fromisoformat(request.data["period_start"])
            period_end = date.fromisoformat(request.data["period_end"])
        except (KeyError, ValueError):
            return Response({"detail": "period_start and period_end must be YYYY-MM-DD."}, status=400)

        payouts = generate_weekly_payouts(period_start, period_end)
        return Response(PayoutSerializer(payouts, many=True).data, status=201)


class AdminPayoutApproveView(APIView):
    """
    POST /api/admin/payouts/batches/:id/approve — approves one payout and
    queues its disbursement. Manual per-payout approval during the pilot
    (WR-06.1's founder-run-ops pattern for anything touching real money
    this early); batch-approve-all can be added once the model is trusted.
    """

    permission_classes = [IsAdminRole]

    def post(self, request, payout_id):
        from payments.tasks import disburse_payout_task

        payout = get_object_or_404(Payout, id=payout_id)
        if payout.status != Payout.Status.PENDING:
            return Response({"detail": f"Payout is {payout.status}, not pending."}, status=409)

        payout.status = Payout.Status.APPROVED
        payout.save(update_fields=["status", "updated_at"])
        disburse_payout_task.delay(str(payout.id))
        return Response(PayoutSerializer(payout).data)
