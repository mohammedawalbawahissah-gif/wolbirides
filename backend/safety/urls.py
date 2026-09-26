from django.urls import path

from safety.views import PublicShareView, TripCheckInView, TripShareView

urlpatterns = [
    path("trips/<uuid:trip_id>/share", TripShareView.as_view(), name="trip-share"),
    path("trips/<uuid:trip_id>/share-link", TripShareView.as_view(), name="trip-share-link"),  # PRD path
    # In-trip "Are you OK?" on overdue trips. (/checkin is the PRD's post-trip check-in.)
    path("trips/<uuid:trip_id>/safety-check", TripCheckInView.as_view(), name="trip-safety-check"),
    path("share/<str:token>", PublicShareView.as_view(), name="public-share"),
]
