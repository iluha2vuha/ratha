"""Campsites, bothies, and stays from OpenStreetMap."""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(tags=["places"])

_OVERPASS_FALLBACKS = (
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
_configured_overpass = os.getenv("BOTHYBOUND_OVERPASS_URL")
OVERPASS_URLS = (
    (_configured_overpass, *(url for url in _OVERPASS_FALLBACKS if url != _configured_overpass))
    if _configured_overpass
    else _OVERPASS_FALLBACKS
)
APP_USER_AGENT = "Ratha/0.1"
_cache: dict[tuple[str, float, float, float, float], tuple[float, list["Place"]]] = {}
_cache_lock = threading.Lock()
CACHE_SECONDS = 600
MAX_SPAN = 2.0

KINDS = {
    "camp_site": ("campsite", "Campsite"),
    "caravan_site": ("campsite", "Campsite"),
    "hostel": ("hostel", "Hostel"),
    "hotel": ("hotel", "Hotel"),
    "motel": ("hotel", "Hotel"),
    "guest_house": ("guest_house", "Guest house"),
    "chalet": ("guest_house", "Guest house"),
}

FOOD = {
    "restaurant": "Restaurant",
    "cafe": "Cafe",
    "fast_food": "Fast food",
    "pub": "Pub",
    "food_court": "Food court",
    "ice_cream": "Ice cream",
    "biergarten": "Food",
    "bakery": "Bakery",
    "convenience": "Shop",
    "supermarket": "Supermarket",
    "greengrocer": "Shop",
    "butcher": "Shop",
    "deli": "Shop",
    "farm": "Farm shop",
}


class Place(BaseModel):
    id: str
    name: str
    kind: str
    kind_label: str
    lat: float
    lon: float
    address: str | None = None
    description: str | None = None
    phone: str | None = None
    website: str | None = None
    opening_hours: str | None = None
    fee: str | None = None
    capacity: str | None = None
    stars: str | None = None
    operator: str | None = None
    osm_url: str


class PlaceList(BaseModel):
    places: list[Place] = Field(default_factory=list)
    attribution: str = "Place data © OpenStreetMap contributors"


def _kind(tags: dict[str, str]) -> tuple[str, str] | None:
    if tags.get("bothy") == "yes" or tags.get("tourism") in {"wilderness_hut", "alpine_hut"} or tags.get("shelter_type") == "basic_hut":
        return "bothy", "Bothy"
    mapped = KINDS.get(tags.get("tourism", ""))
    return mapped


def _facility_kind(tags: dict[str, str]) -> tuple[str, str] | None:
    amenity = tags.get("amenity", "")
    if amenity in FOOD or tags.get("shop", "") in FOOD:
        return "food", FOOD.get(amenity) or FOOD[tags["shop"]]
    if amenity in {"drinking_water", "water_point"} or tags.get("man_made") == "water_tap" or (amenity == "fountain" and tags.get("drinking_water") == "yes"):
        return "water", "Drinking water"
    if tags.get("natural") == "spring":
        return "water", "Spring"
    if tags.get("waterway") == "stream" and tags.get("name"):
        return "water", "Stream"
    return None


def _address(tags: dict[str, str]) -> str | None:
    full = tags.get("addr:full")
    if full:
        return full
    street = " ".join(part for part in (tags.get("addr:housenumber"), tags.get("addr:street")) if part)
    parts = [part for part in (street, tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village"), tags.get("addr:postcode")) if part]
    return ", ".join(parts) or None


def _website(value: str | None) -> str | None:
    if not value:
        return None
    site = value.strip()
    if site.startswith(("http://", "https://")):
        return site
    if "://" in site or site.startswith(("javascript:", "data:")):
        return None
    return f"https://{site}"


def _capacity(tags: dict[str, str]) -> str | None:
    parts: list[str] = []
    if tags.get("capacity"):
        parts.append(f"{tags['capacity']} people")
    if tags.get("tents"):
        parts.append(f"{tags['tents']} tents")
    if tags.get("caravans"):
        parts.append(f"{tags['caravans']} caravans")
    return ", ".join(parts) or None


def _place(element: dict, group: str = "stays", classify: Callable[[dict[str, str]], tuple[str, str] | None] | None = None) -> Place | None:
    tags = element.get("tags") or {}
    if not isinstance(tags, dict):
        return None
    clean_tags = {str(key): str(value) for key, value in tags.items()}
    kind = (classify or (_facility_kind if group == "facilities" else _kind))(clean_tags)
    if not kind:
        return None
    center = element.get("center") or {}
    lat = element.get("lat", center.get("lat"))
    lon = element.get("lon", center.get("lon"))
    element_type = element.get("type")
    element_id = element.get("id")
    if lat is None or lon is None or element_type not in {"node", "way", "relation"} or element_id is None:
        return None
    label_kind, label = kind
    name = str(clean_tags.get("name") or clean_tags.get("official_name") or f"Unnamed {label.lower()}")
    return Place(
        id=f"{element_type}/{element_id}",
        name=name,
        kind=label_kind,
        kind_label=label,
        lat=float(lat),
        lon=float(lon),
        address=_address(clean_tags),
        description=clean_tags.get("description"),
        phone=clean_tags.get("phone") or clean_tags.get("contact:phone"),
        website=_website(clean_tags.get("website") or clean_tags.get("contact:website")),
        opening_hours=clean_tags.get("opening_hours"),
        fee=clean_tags.get("fee") or clean_tags.get("charge"),
        capacity=_capacity(clean_tags),
        stars=clean_tags.get("stars"),
        operator=clean_tags.get("operator"),
        osm_url=f"https://www.openstreetmap.org/{element_type}/{element_id}",
    )


def _query(group: str, south: float, west: float, north: float, east: float) -> str:
    box = f"({south},{west},{north},{east})"
    if group == "facilities":
        return f"""
[out:json][timeout:20];
(
  nwr["amenity"~"^(drinking_water|water_point)$"]{box};
  nwr["man_made"="water_tap"]{box};
  nwr["natural"="spring"]{box};
  nwr["amenity"="fountain"]["drinking_water"="yes"]{box};
  nwr["waterway"="stream"]["name"]{box};
)->.water;
.water out center tags 60;
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|pub|food_court|ice_cream|biergarten)$"]{box};
  nwr["shop"~"^(bakery|convenience|supermarket|greengrocer|butcher|deli|farm)$"]{box};
)->.food;
.food out center tags 80;
"""
    return f"""
[out:json][timeout:25];
(
  nwr["tourism"~"^(camp_site|caravan_site|hostel|hotel|guest_house|motel|chalet|wilderness_hut|alpine_hut)$"]{box};
  nwr["amenity"="shelter"]["shelter_type"="basic_hut"]{box};
  nwr["bothy"="yes"]{box};
);
out center tags 200;
"""


class OverpassUnavailable(Exception):
    def __init__(self, busy: bool, message: str):
        super().__init__(message)
        self.busy = busy


def overpass_elements(query: str, timeout: int = 15) -> list[dict]:
    """Run an Overpass query against each mirror in turn and return its elements."""
    payload = None
    busy = False
    body = query.encode("utf-8")
    for url in OVERPASS_URLS:
        request = Request(
            url,
            data=body,
            headers={"User-Agent": APP_USER_AGENT, "Accept": "application/json", "Content-Type": "text/plain"},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except HTTPError as error:
            busy = busy or error.code in {429, 504}
            continue
        except (URLError, TimeoutError, json.JSONDecodeError):
            continue
    if payload is None:
        raise OverpassUnavailable(busy, "OpenStreetMap place search is busy." if busy else "Could not reach OpenStreetMap place search.")
    elements = payload.get("elements") if isinstance(payload, dict) else None
    if not isinstance(elements, list):
        raise OverpassUnavailable(False, "OpenStreetMap place search returned an unexpected response.")
    return [element for element in elements if isinstance(element, dict)]


def _overpass(group: str, south: float, west: float, north: float, east: float) -> list[Place]:
    try:
        elements = overpass_elements(_query(group, south, west, north, east))
    except OverpassUnavailable as error:
        if error.busy:
            raise HTTPException(503, "The place search is busy. Zoom in and try again shortly.") from error
        raise HTTPException(502, str(error)) from error
    places = [place for element in elements if (place := _place(element, group))]
    if group == "facilities":
        midpoint = ((south + north) / 2, (west + east) / 2)
        streams: dict[str, Place] = {}
        kept: list[Place] = []
        for place in places:
            if place.kind_label != "Stream":
                kept.append(place)
                continue
            current = streams.get(place.name.casefold())
            if current is None or abs(place.lat - midpoint[0]) + abs(place.lon - midpoint[1]) < abs(current.lat - midpoint[0]) + abs(current.lon - midpoint[1]):
                streams[place.name.casefold()] = place
        nearest = sorted(
            streams.values(),
            key=lambda place: abs(place.lat - midpoint[0]) + abs(place.lon - midpoint[1]),
        )[:8]
        places = kept + nearest
    places.sort(key=lambda place: (place.kind, place.name.casefold()))
    return places


@router.get("/places", response_model=PlaceList)
def list_places(
    south: float = Query(ge=-90, le=90),
    west: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180),
    group: str = "stays",
) -> PlaceList:
    """Return stays, or water and food, inside a map view."""
    if group not in {"stays", "facilities"}:
        raise HTTPException(422, "Unknown place group.")
    if south >= north or west >= east:
        raise HTTPException(422, "The map view is not a valid area.")
    if max(north - south, east - west) > MAX_SPAN:
        return PlaceList(places=[])
    key = (group, round(south, 2), round(west, 2), round(north, 2), round(east, 2))
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < CACHE_SECONDS:
            return PlaceList(places=cached[1])
    places = _overpass(*key)
    with _cache_lock:
        _cache[key] = (time.monotonic(), places)
    return PlaceList(places=places)
