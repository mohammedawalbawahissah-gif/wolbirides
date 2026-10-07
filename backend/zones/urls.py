from django.urls import path

from zones.views import PlaceSearchView, ZoneListView

urlpatterns = [
    path("zones", ZoneListView.as_view(), name="zone-list"),
    path("places/search", PlaceSearchView.as_view(), name="place-search"),
]
