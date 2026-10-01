from core.throttling import ActionRateThrottle
from rest_framework import serializers, status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from safety import services
from safety.models import SafetyCheckIn, TripShare
from trips.models import Trip


class TripShareView(APIView):
    """POST /api/trips/:id/share — passenger creates a live share link.
    DELETE revokes every active link for the trip."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ActionRateThrottle]
    throttle_scope = "trip_share"

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if trip.passenger_id != request.user.id:
            return Response({"detail": "Only the passenger can share this trip."}, status=status.HTTP_403_FORBIDDEN)
        if trip.status not in ("requested", "matching", "awaiting_assignment", *services.ACTIVE_STATUSES):
            return Response({"detail": "Only active trips can be shared."}, status=status.HTTP_409_CONFLICT)
        send = bool(request.data.get("send_to_contact"))
        share = services.create_share(trip, request.user, send_to_contact=send)
        return Response(
            {"url": services.share_url(share), "token": share.token, "sent_to_contact": bool(share.sent_to_phone)},
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request, trip_id):
        from django.utils import timezone

        trip = get_object_or_404(Trip, id=trip_id)
        if trip.passenger_id != request.user.id:
            return Response(status=status.HTTP_403_FORBIDDEN)
        trip.shares.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicShareView(APIView):
    """GET /api/share/:token — no login; returns only what a follower needs."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, token):
        share = TripShare.objects.select_related("trip", "trip__passenger", "trip__driver__user").filter(token=token).first()
        if not share or not services.share_is_live(share):
            return Response({"detail": "This link has expired or was turned off."}, status=status.HTTP_404_NOT_FOUND)
        return Response(services.public_trip_view(share))


class CheckInSerializer(serializers.ModelSerializer):
    class Meta:
        model = SafetyCheckIn
        fields = ["id", "reason", "response", "responded_at", "escalated_at", "created_at"]


class TripCheckInView(APIView):
    """GET /api/trips/:id/check-in — pending prompt or null.
    POST {"response": "ok" | "help"} answers it."""

    permission_classes = [IsAuthenticated]

    def _trip(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if trip.passenger_id != request.user.id:
            return None
        return trip

    def get(self, request, trip_id):
        trip = self._trip(request, trip_id)
        if not trip:
            return Response(status=status.HTTP_403_FORBIDDEN)
        pending = services.pending_check_in(trip)
        return Response(CheckInSerializer(pending).data if pending else None)

    def post(self, request, trip_id):
        trip = self._trip(request, trip_id)
        if not trip:
            return Response(status=status.HTTP_403_FORBIDDEN)
        response = request.data.get("response")
        if response not in SafetyCheckIn.Response.values:
            return Response({"detail": "response must be 'ok' or 'help'."}, status=status.HTTP_400_BAD_REQUEST)
        # Answering even after escalation is still useful: it tells ops the passenger is reachable.
        check_in = trip.check_ins.filter(responded_at__isnull=True).first()
        if not check_in:
            return Response({"detail": "There's no check-in waiting for you."}, status=status.HTTP_404_NOT_FOUND)
        services.respond_to_check_in(check_in, request.user, response)
        return Response(CheckInSerializer(check_in).data)
