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
from datetime import timedelta

import redis.asyncio as aioredis
from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone

DRIVER_LOCATION_TTL_SECONDS = 20
_redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)


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


async def remove_driver_location(driver_id):
    await _redis.delete(_driver_key(driver_id))


async def get_online_driver_ids(zone_id):
    return await _redis.smembers(f"zone:online_drivers:{zone_id}")


async def get_driver_location(driver_id):
    raw = await _redis.get(_driver_key(driver_id))
    return json.loads(raw) if raw else None


def _haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def rank_candidate_drivers(zone_id, pickup_lat, pickup_lng, exclude_driver_ids=None):
    """
    Returns driver_ids in the given zone, sorted nearest-first by straight-line
    distance to pickup. Verification/compliance filtering happens before this
    call (candidates are only ever added to the online set if verified —
    see drivers/services.py::set_driver_online).
    """
    exclude_driver_ids = exclude_driver_ids or set()
    driver_ids = await get_online_driver_ids(zone_id)
    scored = []
    for driver_id in driver_ids:
        if driver_id in exclude_driver_ids:
            continue
        loc = await get_driver_location(driver_id)
        if not loc:
            continue
        dist = _haversine_km(float(pickup_lat), float(pickup_lng), loc["lat"], loc["lng"])
        scored.append((dist, driver_id))
    scored.sort(key=lambda t: t[0])
    return [driver_id for _, driver_id in scored]
