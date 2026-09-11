from django.urls import path

from trips.views import (
    DriverActiveTripView,
    PassengerTripHistoryView,
    TripAcceptView,
    TripCancelView,
    TripCompleteView,
    TripDeclineView,
    TripDetailView,
    TripRatingView,
    TripRequestView,
    TripStartView,
)

urlpatterns = [
    path("trips", TripRequestView.as_view(), name="trip-request"),
    path("passengers/me/rides", PassengerTripHistoryView.as_view(), name="passenger-trip-history"),
    path("drivers/me/active-trip", DriverActiveTripView.as_view(), name="driver-active-trip"),
    path("trips/<uuid:trip_id>", TripDetailView.as_view(), name="trip-detail"),
    path("trips/<uuid:trip_id>/accept", TripAcceptView.as_view(), name="trip-accept"),
    path("trips/<uuid:trip_id>/decline", TripDeclineView.as_view(), name="trip-decline"),
    path("trips/<uuid:trip_id>/cancel", TripCancelView.as_view(), name="trip-cancel"),
    path("trips/<uuid:trip_id>/start", TripStartView.as_view(), name="trip-start"),
    path("trips/<uuid:trip_id>/complete", TripCompleteView.as_view(), name="trip-complete"),
    path("trips/<uuid:trip_id>/rating", TripRatingView.as_view(), name="trip-rating"),
]
