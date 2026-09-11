from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from trips import services
from trips.models import Rating, Trip
from trips.serializers import (
    RatingSerializer,
    TripCancelSerializer,
    TripRequestSerializer,
    TripSerializer,
)
from zones.models import ServiceZone


class TripRequestView(APIView):
    """POST /api/trips — PRD Section 6.2 step 1, then kicks off dispatch."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        zone = get_object_or_404(ServiceZone, id=data["zone_id"], active=True)

        trip = services.request_trip(
            passenger=request.user,
            zone=zone,
            pickup={"lat": data["pickup_lat"], "lng": data["pickup_lng"], "label": data.get("pickup_label", "")},
            destination={
                "lat": data["destination_lat"],
                "lng": data["destination_lng"],
                "label": data.get("destination_label", ""),
            },
            distance_km=data["distance_km"],
        )
        services.start_dispatch_cascade(trip)
        trip.refresh_from_db()
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)


class TripDetailView(APIView):
    """GET /api/trips/:id"""

    permission_classes = [IsAuthenticated]

    def get(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not services.user_can_access_trip(request.user, trip):
            raise PermissionDenied()
        return Response(TripSerializer(trip).data)


class TripCancelView(APIView):
    """POST /api/trips/:id/cancel"""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not services.user_can_access_trip(request.user, trip):
            raise PermissionDenied()
        serializer = TripCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cancelled_by = "driver" if request.user.role == "driver" else "passenger"
        trip = services.cancel_trip(trip, cancelled_by, serializer.validated_data["reason"])
        return Response(TripSerializer(trip).data)


class TripCompleteView(APIView):
    """POST /api/trips/:id/complete — driver marks trip done."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not trip.driver or trip.driver.user_id != request.user.id:
            raise PermissionDenied("Only the assigned driver can complete this trip")
        trip = services.complete_trip(trip)
        return Response(TripSerializer(trip).data)


class PassengerTripHistoryView(APIView):
    """GET /api/passengers/me/rides — PRD Section 7."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        trips = Trip.objects.filter(passenger=request.user).order_by("-requested_at")[:100]
        return Response(TripSerializer(trips, many=True).data)


class TripAcceptView(APIView):
    """POST /api/trips/:id/accept — driver accepts an offered trip."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only drivers can accept trips")
        try:
            trip = services.accept_trip(trip, request.user.driver_profile)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(TripSerializer(trip).data)


class TripDeclineView(APIView):
    """POST /api/trips/:id/decline — driver declines an offer; cascades to the next candidate."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only drivers can decline trips")
        services.decline_or_timeout(trip, str(request.user.driver_profile.id))
        return Response({"detail": "declined"})


class TripStartView(APIView):
    """POST /api/trips/:id/start — driver marks trip as started (pickup complete)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not trip.driver or trip.driver.user_id != request.user.id:
            raise PermissionDenied("Only the assigned driver can start this trip")
        trip = services.start_trip(trip)
        return Response(TripSerializer(trip).data)


class DriverActiveTripView(APIView):
    """
    GET /api/drivers/me/active-trip — lets the driver app recover state on
    load/reconnect (e.g. after a refresh mid-trip) without tracking trip_id
    client-side across sessions.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not hasattr(request.user, "driver_profile"):
            raise PermissionDenied("Only drivers can query this")
        trip = (
            Trip.objects.filter(
                driver=request.user.driver_profile,
                status__in=[Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING, Trip.Status.IN_PROGRESS],
            )
            .order_by("-requested_at")
            .first()
        )
        if not trip:
            return Response(None)
        return Response(TripSerializer(trip).data)


class TripRatingView(APIView):
    """POST /api/trips/:id/rating"""

    permission_classes = [IsAuthenticated]

    def post(self, request, trip_id):
        trip = get_object_or_404(Trip, id=trip_id)
        if not services.user_can_access_trip(request.user, trip):
            raise PermissionDenied()

        rated_user = trip.driver.user if request.user.id == trip.passenger_id else trip.passenger
        serializer = RatingSerializer(data={**request.data, "trip": trip.id, "rated": rated_user.id})
        serializer.is_valid(raise_exception=True)
        rating = Rating.objects.create(
            trip=trip,
            rater=request.user,
            rated=rated_user,
            score=serializer.validated_data["score"],
            issue_tags=serializer.validated_data.get("issue_tags", []),
            comment=serializer.validated_data.get("comment", ""),
        )
        return Response(RatingSerializer(rating).data, status=status.HTTP_201_CREATED)
