"""Place search behind GET /api/places/search.

Order of answers: places ops have added (Place), then pickup points, then an outside map service for whatever is
still missing. The outside call is made from here, not from the passenger's phone, so the API key stays secret,
answers are cached, and one provider can be swapped for another without touching the apps.
"""
import hashlib
import json
import logging
import math

import requests
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q

from zones.models import PickupPoint, Place

log = logging.getLogger(__name__)

MAX_RESULTS = 8
MIN_QUERY = 2
HTTP_TIMEOUT = 4


# ---------------------------------------------------------------- zone box

def zone_bbox(zone):
    """(min_lat, min_lng, max_lat, max_lng) for a zone, or None. Understands the simple box dict and a GeoJSON polygon."""
    b = (zone.boundary or {}) if zone else {}
    try:
        if all(k in b for k in ("min_lat", "max_lat", "min_lng", "max_lng")):
            return float(b["min_lat"]), float(b["min_lng"]), float(b["max_lat"]), float(b["max_lng"])
        geometry = b.get("geometry", b) if isinstance(b, dict) else {}
        ring = geometry.get("coordinates", [[]])[0]
        lngs = [float(p[0]) for p in ring]
        lats = [float(p[1]) for p in ring]
        if lngs and lats:
            return min(lats), min(lngs), max(lats), max(lngs)
    except (TypeError, ValueError, IndexError, KeyError, AttributeError):
        pass
    return None


def _km(lat1, lng1, lat2, lng2):
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- local

def _tokens(q):
    return [t for t in q.lower().replace(",", " ").split() if t]


def _rank(name, q, popularity):
    n = name.lower()
    if n == q:
        tier = 0
    elif n.startswith(q):
        tier = 1
    elif any(w.startswith(q) for w in n.split()):
        tier = 2
    else:
        tier = 3
    return (tier, -popularity, len(n))


def search_local(q, zone=None, limit=MAX_RESULTS):
    tokens = _tokens(q)
    if not tokens:
        return []
    ql = " ".join(tokens)

    places = Place.objects.filter(is_active=True)
    points = PickupPoint.objects.all()
    if zone is not None:
        places = places.filter(Q(zone=zone) | Q(zone__isnull=True))
        points = points.filter(zone=zone)
    for t in tokens:
        places = places.filter(Q(name__icontains=t) | Q(aliases__icontains=t) | Q(area__icontains=t))
        points = points.filter(name__icontains=t)

    found = []
    for p in places[:50]:
        found.append((_rank(p.name, ql, p.popularity), {
            "id": f"place:{p.id}", "name": p.name, "label": p.name + (f", {p.area}" if p.area else ""),
            "lat": float(p.latitude), "lng": float(p.longitude), "source": "place",
        }))
    for pt in points[:50]:
        found.append(((_rank(pt.name, ql, 0)[0], 1, len(pt.name)), {
            "id": f"pickup:{pt.id}", "name": pt.name, "label": pt.name,
            "lat": float(pt.latitude), "lng": float(pt.longitude), "source": "pickup",
        }))
    found.sort(key=lambda x: x[0])
    return [r for _, r in found[:limit]]


# ---------------------------------------------------------------- outside providers
# Every provider returns [{"name", "label", "lat", "lng"}] already restricted to Ghana.

def _short_name(display_name):
    return (display_name or "").split(",")[0].strip() or display_name or ""


def _nominatim(q, bbox, near):
    params = {"format": "jsonv2", "q": q, "limit": 6, "countrycodes": "gh", "addressdetails": 0}
    if bbox:
        min_lat, min_lng, max_lat, max_lng = bbox
        params.update(viewbox=f"{min_lng},{max_lat},{max_lng},{min_lat}", bounded=1)
    # OpenStreetMap's public service allows about one request a second per application: skip this call, rather
    # than break that rule, when another search has just used the slot (the curated places still answer).
    if not cache.add("geocode:nominatim:slot", 1, timeout=1):
        return []
    r = requests.get("https://nominatim.openstreetmap.org/search", params=params, timeout=HTTP_TIMEOUT,
                     headers={"User-Agent": settings.GEOCODER_USER_AGENT})
    r.raise_for_status()
    return [{"name": it.get("name") or _short_name(it.get("display_name")), "label": it.get("display_name", ""),
             "lat": float(it["lat"]), "lng": float(it["lon"])} for it in r.json()]


def _locationiq(q, bbox, near):
    params = {"key": settings.GEOCODER_API_KEY, "q": q, "limit": 6, "countrycodes": "gh", "format": "json"}
    if bbox:
        min_lat, min_lng, max_lat, max_lng = bbox
        params.update(viewbox=f"{min_lng},{max_lat},{max_lng},{min_lat}", bounded=1)
    r = requests.get("https://api.locationiq.com/v1/autocomplete", params=params, timeout=HTTP_TIMEOUT)
    if r.status_code == 404:  # LocationIQ answers "no match" with 404
        return []
    r.raise_for_status()
    return [{"name": it.get("display_place") or _short_name(it.get("display_name")),
             "label": it.get("display_name", ""), "lat": float(it["lat"]), "lng": float(it["lon"])} for it in r.json()]


def _geoapify(q, bbox, near):
    params = {"text": q, "apiKey": settings.GEOCODER_API_KEY, "limit": 6, "format": "json"}
    if bbox:
        min_lat, min_lng, max_lat, max_lng = bbox
        params["filter"] = f"rect:{min_lng},{min_lat},{max_lng},{max_lat}"
    else:
        params["filter"] = "countrycode:gh"
    if near:
        params["bias"] = f"proximity:{near[1]},{near[0]}"
    r = requests.get("https://api.geoapify.com/v1/geocode/autocomplete", params=params, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    out = []
    for it in r.json().get("results", []):
        if "lat" not in it or "lon" not in it:
            continue
        label = it.get("formatted", "")
        out.append({"name": it.get("name") or _short_name(label), "label": label,
                    "lat": float(it["lat"]), "lng": float(it["lon"])})
    return out


PROVIDERS = {"nominatim": _nominatim, "locationiq": _locationiq, "geoapify": _geoapify}


def search_external(q, zone=None, near=None):
    name = settings.GEOCODER_PROVIDER
    fn = PROVIDERS.get(name)
    if not fn:
        return []
    if name != "nominatim" and not settings.GEOCODER_API_KEY:
        log.warning("GEOCODER_PROVIDER=%s needs GEOCODER_API_KEY; skipping outside search", name)
        return []
    bbox = zone_bbox(zone)
    key = "geocode:" + hashlib.sha1(json.dumps([name, q.lower(), bbox], default=str).encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        results = fn(q, bbox, near)
    except Exception as exc:  # a provider outage must never take the search (or the booking screen) down
        log.warning("Outside place search (%s) failed: %s", name, exc)
        return []
    if results:  # don't remember "nothing" for a day: it may only have been the one-a-second slot
        cache.set(key, results, settings.GEOCODER_CACHE_SECONDS)
    return results


# ---------------------------------------------------------------- everything together

def search(q, zone=None, near=None, limit=MAX_RESULTS):
    q = (q or "").strip()[:100]
    if len(q) < MIN_QUERY:
        return []
    results = search_local(q, zone, limit)
    if len(results) < min(limit, 5):
        for item in search_external(q, zone, near):
            dup = any(_km(item["lat"], item["lng"], r["lat"], r["lng"]) < 0.08 for r in results)
            if dup:
                continue
            results.append({"id": f"map:{item['lat']:.5f},{item['lng']:.5f}", "name": item["name"],
                            "label": item["label"] or item["name"], "lat": round(item["lat"], 6),
                            "lng": round(item["lng"], 6), "source": "map"})
            if len(results) >= limit:
                break
    return results
