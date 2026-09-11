from django.urls import re_path

from trips import consumers

websocket_urlpatterns = [
    re_path(r"^ws/driver/location/?$", consumers.DriverLocationConsumer.as_asgi()),
    re_path(r"^ws/trip/(?P<trip_id>[0-9a-f-]+)/?$", consumers.TripConsumer.as_asgi()),
    re_path(r"^ws/admin/zone/(?P<zone_id>[0-9a-f-]+)/live/?$", consumers.AdminZoneLiveConsumer.as_asgi()),
]
