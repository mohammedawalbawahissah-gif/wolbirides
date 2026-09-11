from django.urls import path

from incidents.views import IncidentCreateView, IncidentUpdateView

urlpatterns = [
    path("incidents", IncidentCreateView.as_view(), name="incident-create"),
    path("incidents/<uuid:incident_id>", IncidentUpdateView.as_view(), name="incident-update"),
]
