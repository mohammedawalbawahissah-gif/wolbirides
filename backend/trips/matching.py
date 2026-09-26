"""
Real-time matching support (PRD Section 6).

Driver location is kept in Redis, not Postgres, because it changes every
4-6 seconds per online driver and the database should only ever see
trip-relevant snapshots (PRD Section 8, non-functional requirements).

Matching itself (PRD Section 6.2) is deliberately simple for MVP: filter by
zone + online + verified, rank by straight-line distance, offer sequentially
with a timeout. No routing-aware ETA, no ML — per WR-05.4 and PRD Section 6.3,
that's only worth building once real acceptance/cancellation data exists.
"""

import json
import math

import redis
import redis.asyncio as aioredis
from django.conf import settings
from django.utils import timezone

DRIVER_LOCATION_TTL_SECONDS = 20
_redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

# Synchronous client for read-only lookups from ordinary (non-async) DRF
# views — e.g. surfacing a driver's live position on the passenger's trip
# detail response. The websocket hot path (ping-heavy, high concurrency)
# stays on the async client above; this one only ever does occasional
# single-key GETs triggered by an HTTP request or trip-status poll, so a
# separate connection pool is simpler than routing every request through
# async_to_sync for the sake of one Redis call.
_redis_sync = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def zone_group_name(zone_id):
    return f"zone.{zone_id}"


def trip_group_name(trip_id):
    return f"trip.{trip_id}"


def driver_group_name(driver_id):
    return f"driver.{driver_id}"


def _driver_key(driver_id):
    return f"driver:location:{driver_id}"


async def write_driver_location(driver_id, lat, lng, zone_id):
    if lat is None or lng is None:
        return
    payload = json.dumps({"lat": lat, "lng": lng, "zone_id": zone_id, "ts": timezone.now().isoformat()})
    await _redis.set(_driver_key(driver_id), payload, ex=DRIVER_LOCATION_TTL_SECONDS)
    if zone_id:
        await _redis.sadd(f"zone:online_drivers:{zone_id}", driver_id)
        await _redis.expire(f"zone:online_drivers:{zone_id}", DRIVER_LOCATION_TTL_SECONDS)


async def remove_driver_location(driver_id, zone_id=None):
    """Drop the driver's live position AND their entry in the zone's online set,
    so a driver who goes offline (or is suspended) stops being a dispatch candidate
    at once instead of lingering while other drivers keep the set alive."""
    raw = await _redis.get(_driver_key(driver_id))
    zone_id = zone_id or (json.loads(raw).get("zone_id") if raw else None)
    await _redis.delete(_driver_key(driver_id))
    if zone_id:
        await _redis.srem(f"zone:online_drivers:{zone_id}", driver_id)


def remove_driver_location_sync(driver_id, zone_id=None):
    """Same as remove_driver_location, for ordinary (non-async) code such as suspensions."""
    raw = _redis_sync.get(_driver_key(driver_id))
    zone_id = zone_id or (json.loads(raw).get("zone_id") if raw else None)
    _redis_sync.delete(_driver_key(driver_id))
    if zone_id:
        _redis_sync.srem(f"zone:online_drivers:{zone_id}", str(driver_id))


async def get_online_driver_ids(zone_id):
    return await _redis.smembers(f"zone:online_drivers:{zone_id}")


async def get_driver_location(driver_id):
    raw = await _redis.get(_driver_key(driver_id))
    return json.loads(raw) if raw else None


def get_driver_location_sync(driver_id):
    """
    Same lookup as get_driver_location, for synchronous callers (ordinary
    DRF views). IMPORTANT: `driver_id` here means the same thing it means
    everywhere else in this module and in consumers.py — the *User* id
    used as the websocket connection's identity (DriverLocationConsumer
    sets self.driver_id = str(self.user.id)), not the Driver model's own
    primary key. Callers must pass str(driver.user_id), not str(driver.id).
    """
    raw = _redis_sync.get(_driver_key(driver_id))
    return json.loads(raw) if raw else None


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# Kept for any existing internal call sites that still use the old private name.
_haversine_km = haversine_km


async def rank_candidate_drivers(zone_id, pickup_lat, pickup_lng, exclude_driver_ids=None):
    """Driver ids nearest-first (kept for callers that don't need distances)."""
    scored = await scored_candidate_drivers(zone_id, pickup_lat, pickup_lng, exclude_driver_ids)
    return [driver_id for _, driver_id in scored]


async def scored_candidate_drivers(zone_id, pickup_lat, pickup_lng, exclude_driver_ids=None):
    """
    Returns (distance_km, driver_user_id) for drivers with a live position in
    the zone, nearest first. Presence only: whether each driver is verified and
    online is checked against the database in trips/services.py::order_candidates,
    because a driver's app can keep pinging after they're suspended.
    """
    exclude_driver_ids = exclude_driver_ids or set()
    driver_ids = [d for d in await get_online_driver_ids(zone_id) if d not in exclude_driver_ids]
    if not driver_ids:
        return []
    # One round-trip for every candidate's position instead of one per driver.
    raw_locations = await _redis.mget([_driver_key(d) for d in driver_ids])
    scored = []
    stale = []
    for driver_id, raw in zip(driver_ids, raw_locations, strict=True):
        if not raw:
            stale.append(driver_id)  # position expired: they stopped pinging
            continue
        loc = json.loads(raw)
        dist = _haversine_km(float(pickup_lat), float(pickup_lng), loc["lat"], loc["lng"])
        scored.append((dist, driver_id))
    if stale:
        await _redis.srem(f"zone:online_drivers:{zone_id}", *stale)
    scored.sort(key=lambda t: t[0])
    return scored
