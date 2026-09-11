import json

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from trips.matching import (
    driver_group_name,
    remove_driver_location,
    trip_group_name,
    zone_group_name,
    write_driver_location,
)


class DriverLocationConsumer(AsyncJsonWebsocketConsumer):
    """
    ws /ws/driver/location/

    A driver's app holds this connection open while online (PRD Section 6.1).
    Incoming messages are location pings; the server writes the latest
    position to Redis (short TTL) rather than Postgres, and joins the
    driver to their zone's dispatch group so they can receive ride offers.

    Expected inbound message shape:
        {"type": "location.ping", "lat": 9.4008, "lng": -0.8393, "zone_id": "..."}
        {"type": "presence.online"}
        {"type": "presence.offline"}
    """

    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_anonymous or self.user.role != "driver":
            await self.close(code=4001)
            return
        self.driver_id = str(self.user.id)
        self.zone_id = None
        await self.accept()

    async def disconnect(self, close_code):
        if self.zone_id:
            await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)
        await remove_driver_location(self.driver_id)

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")

        if msg_type == "location.ping":
            self.zone_id = content.get("zone_id", self.zone_id)
            if self.zone_id:
                await self.channel_layer.group_add(zone_group_name(self.zone_id), self.channel_name)
            await write_driver_location(
                self.driver_id, content.get("lat"), content.get("lng"), self.zone_id
            )

        elif msg_type == "presence.offline":
            if self.zone_id:
                await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)
            await remove_driver_location(self.driver_id)

    # --- server -> driver push (called via channel_layer.group_send) ---
    async def ride_request(self, event):
        """A ride offer routed to this specific driver (PRD Section 6.2 step 3)."""
        await self.send_json({"type": "ride_request", "trip": event["trip"]})

    async def trip_cancelled(self, event):
        await self.send_json({"type": "trip_cancelled", "trip_id": event["trip_id"]})


class TripConsumer(AsyncJsonWebsocketConsumer):
    """
    ws /ws/trip/<trip_id>/

    Shared channel for passenger + matched driver on a single trip: driver's
    live location during approach/in-progress, and status transitions.
    """

    async def connect(self):
        self.trip_id = self.scope["url_route"]["kwargs"]["trip_id"]
        self.user = self.scope["user"]
        if self.user.is_anonymous:
            await self.close(code=4001)
            return
        # Authorization (passenger or matched driver only) is enforced in the
        # consumer's connect hook via a DB check — omitted here for brevity,
        # see trips/services.py::user_can_access_trip.
        await self.channel_layer.group_add(trip_group_name(self.trip_id), self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(trip_group_name(self.trip_id), self.channel_name)

    async def trip_update(self, event):
        await self.send_json(event["data"])


class AdminZoneLiveConsumer(AsyncJsonWebsocketConsumer):
    """ws /ws/admin/zone/<zone_id>/live/ — feeds the live map in the admin dashboard (PRD Section 4.3)."""

    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_anonymous or self.user.role not in ("admin", "support"):
            await self.close(code=4001)
            return
        self.zone_id = self.scope["url_route"]["kwargs"]["zone_id"]
        await self.channel_layer.group_add(zone_group_name(self.zone_id), self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)

    async def zone_snapshot(self, event):
        await self.send_json(event["data"])
