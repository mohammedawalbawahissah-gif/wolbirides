from django.urls import path

from trips.views import (
    PassengerTripHistoryView,
    TripCancelView,
    TripCompleteView,
    TripDetailView,
    TripRatingView,
    TripRequestView,
)

urlpatterns = [
    path("trips", TripRequestView.as_view(), name="trip-request"),
    path("passengers/me/rides", PassengerTripHistoryView.as_view(), name="passenger-trip-history"),
    path("trips/<uuid:trip_id>", TripDetailView.as_view(), name="trip-detail"),
    path("trips/<uuid:trip_id>/cancel", TripCancelView.as_view(), name="trip-cancel"),
    path("trips/<uuid:trip_id>/complete", TripCompleteView.as_view(), name="trip-complete"),
    path("trips/<uuid:trip_id>/rating", TripRatingView.as_view(), name="trip-rating"),
]
