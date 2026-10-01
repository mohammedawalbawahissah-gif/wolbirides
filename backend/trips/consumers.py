import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from trips.matching import (
    driver_group_name,
    remove_driver_location,
    trip_group_name,
    zone_group_name,
    write_driver_location,
)


ELIGIBILITY_RECHECK_SECONDS = 30  # re-read verified/online from the DB at most this often per driver
ARRIVAL_IDLE_SKIP_SECONDS = 15  # with no trip waiting for pickup, skip the arrival query this long


class DriverLocationConsumer(AsyncJsonWebsocketConsumer):
    """
    ws /ws/driver/location/

    A driver's app holds this connection open while online (PRD Section 6.1).
    Incoming messages are location pings; the server writes the latest
    position to Redis (short TTL) rather than Postgres, and joins the
    driver to their zone's dispatch group so they can receive ride offers.

    Security: only verified drivers may connect, and pings only count while the
    driver is verified AND online in the database (re-checked every 30s, and at
    once when the server pushes force_offline). Without this, a suspended
    driver's app could keep itself in the dispatch pool.

    Expected inbound message shape:
        {"type": "location.ping", "lat": 9.4008, "lng": -0.8393, "zone_id": "..."}
        {"type": "presence.offline"}
    """

    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_anonymous or self.user.role != "driver":
            await self.close(code=4001)
            return
        if not await self._is_verified():
            await self.close(code=4003)
            return
        self.driver_id = str(self.user.id)
        self.zone_id = None
        self._eligible = None
        self._eligible_checked_at = 0.0
        self._arrival_skip_until = 0.0
        self._tracking_mode = None
        # Personal group: ride offers and force_offline pushes are sent to "driver.<id>".
        await self.channel_layer.group_add(driver_group_name(self.driver_id), self.channel_name)
        await self.accept()
        await self._send_tracking_mode()

    async def disconnect(self, close_code):
        if not hasattr(self, "driver_id"):
            return
        await self.channel_layer.group_discard(driver_group_name(self.driver_id), self.channel_name)
        if self.zone_id:
            await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)
        await remove_driver_location(self.driver_id, self.zone_id)

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")

        if msg_type == "location.ping":
            if not await self._currently_eligible():
                # Verified-and-online is required to be dispatchable; tell the app so it stops.
                await remove_driver_location(self.driver_id, self.zone_id)
                await self.send_json({"type": "force_offline", "reason": "not_online"})
                return
            self.zone_id = content.get("zone_id", self.zone_id)
            if self.zone_id:
                await self.channel_layer.group_add(zone_group_name(self.zone_id), self.channel_name)
            await write_driver_location(
                self.driver_id, content.get("lat"), content.get("lng"), self.zone_id
            )
            now = time.monotonic()
            if now >= self._arrival_skip_until:
                waiting = await self._check_arriving(content.get("lat"), content.get("lng"))
                if not waiting:
                    self._arrival_skip_until = now + ARRIVAL_IDLE_SKIP_SECONDS

        elif msg_type == "presence.offline":
            if self.zone_id:
                await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)
            await remove_driver_location(self.driver_id, self.zone_id)

    async def _currently_eligible(self):
        now = time.monotonic()
        if self._eligible is None or now - self._eligible_checked_at > ELIGIBILITY_RECHECK_SECONDS:
            self._eligible = await self._is_verified_and_online()
            self._eligible_checked_at = now
            await self._send_tracking_mode()
        return self._eligible

    async def _send_tracking_mode(self, mode=None):
        """
        Battery: tell the app how hard to track. "active" (precise, every 5s) while
        heading to or carrying a passenger; "idle" (every 15s, lighter GPS) while waiting
        for work. Sent on connect, whenever it changes, and when a trip is accepted.
        """
        mode = mode or ("active" if await self._has_active_trip() else "idle")
        if mode != self._tracking_mode:
            self._tracking_mode = mode
            await self.send_json({"type": "tracking_mode", "mode": mode})

    @database_sync_to_async
    def _has_active_trip(self):
        from trips.models import Trip

        return Trip.objects.filter(
            driver__user_id=self.user.id,
            status__in=[Trip.Status.MATCHED, Trip.Status.DRIVER_ARRIVING, Trip.Status.IN_PROGRESS],
        ).exists()

    @database_sync_to_async
    def _is_verified(self):
        from drivers.models import Driver

        return Driver.objects.filter(user_id=self.user.id, verification_status=Driver.VerificationStatus.VERIFIED).exists()

    @database_sync_to_async
    def _is_verified_and_online(self):
        from drivers.models import Driver

        return Driver.objects.filter(
            user_id=self.user.id, verification_status=Driver.VerificationStatus.VERIFIED, is_online=True,
        ).exists()

    @database_sync_to_async
    def _check_arriving(self, lat, lng):
        from trips.services import check_and_mark_driver_arriving

        return check_and_mark_driver_arriving(self.driver_id, lat, lng)

    # --- server -> driver push (called via channel_layer.group_send) ---
    async def ride_request(self, event):
        """A ride offer routed to this specific driver (PRD Section 6.2 step 3)."""
        await self.send_json({"type": "ride_request", "trip": event["trip"]})

    async def trip_cancelled(self, event):
        await self.send_json({"type": "trip_cancelled", "trip_id": event["trip_id"]})

    async def tracking_mode(self, event):
        await self._send_tracking_mode(event.get("mode"))

    async def force_offline(self, event):
        """Sent when the driver goes offline, is suspended or is rejected."""
        self._eligible = False
        self._eligible_checked_at = time.monotonic()
        await self.send_json({"type": "force_offline", "reason": event.get("reason", "offline")})


class TripConsumer(AsyncJsonWebsocketConsumer):
    """
    ws /ws/trip/<trip_id>/

    Live status updates for one trip. Only the passenger, the assigned driver, or
    admin/support may subscribe (same rule as the HTTP API, via
    trips/services.py::user_can_access_trip).
    """

    async def connect(self):
        self.trip_id = self.scope["url_route"]["kwargs"]["trip_id"]
        self.user = self.scope["user"]
        if self.user.is_anonymous or not await self._can_access():
            await self.close(code=4003)
            return
        await self.channel_layer.group_add(trip_group_name(self.trip_id), self.channel_name)
        await self.accept()

    @database_sync_to_async
    def _can_access(self):
        from trips.models import Trip
        from trips.services import user_can_access_trip

        trip = Trip.objects.filter(id=self.trip_id).select_related("driver").first()
        return bool(trip and user_can_access_trip(self.user, trip))

    async def disconnect(self, close_code):
        if hasattr(self, "trip_id") and not self.user.is_anonymous:
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
        if hasattr(self, "zone_id"):  # rejected connections never joined a group
            await self.channel_layer.group_discard(zone_group_name(self.zone_id), self.channel_name)

    async def zone_snapshot(self, event):
        await self.send_json(event["data"])
