"""Rated overnight stays from Google Places (New), for the planner and route generation."""

from __future__ import annotations

import json
import logging
import math
import os
import ssl
import threading
import time
from typing import Any, Literal, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel

try:
    import certifi
except ImportError:  # pragma: no cover - certifi is listed in requirements.txt
    certifi = None

logger = logging.getLogger(__name__)

PLACES_URL = "https://places.googleapis.com/v1"
FIELD_MASK = ",".join(
    f"places.{field}"
    for field in ("id", "displayName", "rating", "userRatingCount", "primaryType", "types",
                  "formattedAddress", "location", "googleMapsUri")
)
SEARCH_RADIUS_M = 20_000.0
MAX_PER_TYPE = 3
CACHE_SECONDS = 1800
ATTRIBUTION = "Ratings and places from Google Maps"

StayType = Literal["bothy", "campsite", "hostel", "hotel"]
_cache: dict[tuple, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


class RatedStay(BaseModel):
    id: str
    name: str
    type: StayType
    lat: float
    lon: float
    distance_km: float
    rating: Optional[float] = None
    review_count: int = 0
    address: Optional[str] = None
    google_maps_url: Optional[str] = None


class GooglePlacesUnavailable(Exception):
    """Google Places is not configured or could not answer."""


def is_configured() -> bool:
    return bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())


def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("GOOGLE_PLACES_API_KEY", "").strip()
    if not api_key:
        raise GooglePlacesUnavailable("Google Places is not configured. Set GOOGLE_PLACES_API_KEY in backend/.env.")
    request = Request(
        f"{PLACES_URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK},
        method="POST",
    )
    context = ssl.create_default_context(cafile=certifi.where() if certifi else None)
    try:
        with urlopen(request, timeout=10, context=context) as response:  # noqa: S310 - fixed Google API host
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        logger.warning("Google Places request failed with HTTP %s", error.code)
        raise GooglePlacesUnavailable("Google Places returned an error.") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.warning("Google Places request failed: %s", type(error).__name__)
        raise GooglePlacesUnavailable("Could not reach Google Places.") from error


def _cached(key: tuple, load):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def locate(text: str) -> tuple[float, float]:
    """Return (lat, lon) for a place name, searched within Scotland."""
    query = " ".join(text.split())
    if "scotland" not in query.casefold():
        query += ", Scotland"

    def load():
        places = _post("/places:searchText", {"textQuery": query, "pageSize": 1, "languageCode": "en"}).get("places", [])
        location = places[0].get("location") if places else None
        if not isinstance(location, dict) or "latitude" not in location or "longitude" not in location:
            return None
        return float(location["latitude"]), float(location["longitude"])

    point = _cached(("locate", query.casefold()), load)
    if point is None:
        raise LookupError(f"Google Places could not find “{text}”.")
    return point


def _stay_type(place: dict[str, Any]) -> StayType | None:
    types = set(place.get("types", []))
    if place.get("primaryType"):
        types.add(place["primaryType"])
    if types & {"campground", "rv_park"}:
        return "campsite"
    if "hostel" in types:
        return "hostel"
    if types & {"hotel", "extended_stay_hotel", "resort_hotel", "inn", "motel", "bed_and_breakfast", "guest_house", "lodging"}:
        return "hotel"
    return None


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _to_stay(place: dict[str, Any], stay_type: StayType, lat: float, lon: float) -> RatedStay | None:
    name = (place.get("displayName") or {}).get("text")
    location = place.get("location") or {}
    try:
        place_lat, place_lon = float(location["latitude"]), float(location["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not isinstance(name, str) or not isinstance(place.get("id"), str):
        return None
    rating = place.get("rating")
    return RatedStay(
        id=place["id"],
        name=name,
        type=stay_type,
        lat=place_lat,
        lon=place_lon,
        distance_km=round(_distance_km(lat, lon, place_lat, place_lon), 1),
        rating=float(rating) if isinstance(rating, (int, float)) else None,
        review_count=int(place.get("userRatingCount") or 0),
        address=place.get("formattedAddress"),
        google_maps_url=place.get("googleMapsUri"),
    )


def stays_near(lat: float, lon: float) -> list[RatedStay]:
    """Bothies, campsites, hostels and hotels within 20 km, best rated first within each type."""
    circle = {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": SEARCH_RADIUS_M}}

    def load():
        lodgings = _post("/places:searchNearby", {
            "includedTypes": ["campground", "rv_park", "hostel", "hotel", "lodging", "bed_and_breakfast", "guest_house", "inn"],
            "maxResultCount": 20,
            "rankPreference": "DISTANCE",
            "languageCode": "en",
            "locationRestriction": circle,
        }).get("places", [])
        bothies = _post("/places:searchText", {
            "textQuery": "bothy",
            "pageSize": 10,
            "languageCode": "en",
            "locationBias": circle,
        }).get("places", [])
        return lodgings, bothies

    lodgings, bothies = _cached(("near", round(lat, 3), round(lon, 3)), load)
    candidates: list[RatedStay] = []
    for place in bothies:
        name = ((place.get("displayName") or {}).get("text") or "").casefold()
        stay = _to_stay(place, "bothy", lat, lon) if "bothy" in name else None
        if stay and stay.distance_km <= SEARCH_RADIUS_M / 1000:
            candidates.append(stay)
    for place in lodgings:
        stay_type = _stay_type(place)
        stay = _to_stay(place, stay_type, lat, lon) if stay_type else None
        if stay:
            candidates.append(stay)

    seen: set[str] = set()
    result: list[RatedStay] = []
    for stay_type in ("bothy", "campsite", "hostel", "hotel"):
        of_type = sorted(
            (stay for stay in candidates if stay.type == stay_type and stay.id not in seen),
            key=lambda stay: (stay.rating is None, -(stay.rating or 0), stay.distance_km),
        )
        for stay in of_type[:MAX_PER_TYPE]:
            seen.add(stay.id)
            result.append(stay)
    return result
