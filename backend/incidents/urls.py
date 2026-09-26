from django.urls import path

from incidents.views import IncidentCreateView, IncidentUpdateView, TripCheckinView, TripSOSView

urlpatterns = [
    path("incidents", IncidentCreateView.as_view(), name="incident-create"),
    path("trips/<uuid:trip_id>/sos", TripSOSView.as_view(), name="trip-sos"),
    path("trips/<uuid:trip_id>/checkin", TripCheckinView.as_view(), name="trip-checkin"),
    path("incidents/<uuid:incident_id>", IncidentUpdateView.as_view(), name="incident-update"),
]
