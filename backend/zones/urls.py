from django.urls import path

from zones.views import ZoneListView

urlpatterns = [
    path("zones", ZoneListView.as_view(), name="zone-list"),
]
