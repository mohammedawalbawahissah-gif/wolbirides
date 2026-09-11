from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.serializers import MomoInitiateSerializer, MomoWebhookSerializer, PaymentSerializer
from payments.services import handle_momo_webhook, initiate_momo_payment
from trips.models import Trip
from trips.services import user_can_access_trip


class MomoInitiateView(APIView):
    """POST /api/payments/momo/initiate — PRD Section 7."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = MomoInitiateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        trip = get_object_or_404(Trip, id=serializer.validated_data["trip_id"])
        if not user_can_access_trip(request.user, trip):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payment = initiate_momo_payment(trip, serializer.validated_data["phone"])
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class MomoWebhookView(APIView):
    """
    POST /api/payments/momo/webhook — called by the payment provider, not
    the app, hence AllowAny + signature verification (added once the
    provider is chosen, per PRD Section 12) instead of JWT auth.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = MomoWebhookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = handle_momo_webhook(**serializer.validated_data)
        return Response(PaymentSerializer(payment).data)
