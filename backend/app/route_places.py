"""Places to stay near rest stops, and shops and utilities along a route, from OpenStreetMap."""
from __future__ import annotations

import threading
import time
from typing import Optional, Sequence

from pydantic import BaseModel

from app.routers.places import OverpassUnavailable, Place, _place, overpass_elements
from app.trip_planner import Mode, cumulative_km, distance_km, project, simplify

CACHE_SECONDS = 600
OVERPASS_TIMEOUT = 20
# Wider than the user's stay radius so a night with nothing nearby can still list the closest mapped stays.
FALLBACK_STAY_KM = 40.0
STAY_FILTERS = (
    '["tourism"~"^(camp_site|caravan_site|hostel|hotel|guest_house|motel|chalet|wilderness_hut|alpine_hut)$"]',
    '["amenity"="shelter"]["shelter_type"="basic_hut"]',
    '["bothy"="yes"]',
)
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = threading.Lock()

FOOD = {"cafe": "Cafe", "restaurant": "Restaurant", "pub": "Pub", "bar": "Bar", "fast_food": "Takeaway"}
SHOPS = {"supermarket": "Supermarket", "convenience": "Shop", "general": "General store", "outdoor": "Outdoor shop",
         "bakery": "Bakery", "greengrocer": "Greengrocer", "butcher": "Butcher", "deli": "Deli", "farm": "Farm shop"}
HEALTH = {"pharmacy": "Pharmacy", "doctors": "Doctor", "clinic": "Clinic", "hospital": "Hospital"}


class RouteAmenity(Place):
    km: float
    off_route_km: float


class NearbyAmenity(Place):
    distance_km: float


def _elements(query: str) -> list[dict]:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(query)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    elements = overpass_elements(query, timeout=OVERPASS_TIMEOUT)
    with _cache_lock:
        _cache[query] = (time.monotonic(), elements)
    return elements


class StaySearch:
    """Places to stay around requested points, using as few Overpass queries as possible.

    Each query covers a circle wider than the search radius, so a rest stop that moves a
    little from its first estimate is usually answered from places already fetched.
    """

    def __init__(self, radius_km: float):
        self.radius_km = radius_km
        self.fallback_km = max(radius_km, FALLBACK_STAY_KM)
        self.circles: list[tuple[float, float, float]] = []
        self.places: dict[str, Place] = {}
        self.failed = False

    def prefetch(self, points: Sequence[tuple[float, float]]) -> None:
        missing = [point for point in points if not self._covered(*point)]
        if missing:
            self._fetch(missing)

    def near(self, lat: float, lon: float) -> Optional[list[Place]]:
        if not self._covered(lat, lon):
            self._fetch([(lat, lon)])
            if not self._covered(lat, lon):
                return None
        return [place for place in self.places.values() if distance_km(lat, lon, place.lat, place.lon) <= self.fallback_km]

    def _covered(self, lat: float, lon: float) -> bool:
        return any(distance_km(lat, lon, c_lat, c_lon) + self.fallback_km <= reach for c_lat, c_lon, reach in self.circles)

    def _fetch(self, points: Sequence[tuple[float, float]]) -> None:
        if self.failed:
            return
        reach = self.fallback_km
        clauses = "".join(f"nwr(around:{reach * 1000:.0f},{lat:.5f},{lon:.5f}){tags};"
                          for lat, lon in points for tags in STAY_FILTERS)
        try:
            elements = _elements(f"[out:json][timeout:25];({clauses});out center tags;")
        except OverpassUnavailable:
            self.failed = True
            return
        for element in elements:
            if place := _place(element):
                self.places[place.id] = place
        self.circles.extend((lat, lon, reach) for lat, lon in points)


def amenity_kind(tags: dict[str, str]) -> tuple[str, str] | None:
    amenity, shop = tags.get("amenity", ""), tags.get("shop", "")
    if amenity in FOOD:
        return "food", FOOD[amenity]
    if shop in SHOPS:
        return "shop", SHOPS[shop]
    if amenity in {"drinking_water", "water_point"} or tags.get("man_made") == "water_tap":
        return "water", "Drinking water"
    if amenity == "toilets":
        return "toilets", "Toilets"
    if amenity == "shower":
        return "toilets", "Showers"
    if amenity in HEALTH or shop == "chemist":
        return "health", HEALTH.get(amenity, "Pharmacy")
    if amenity == "atm":
        return "cash", "Cash machine"
    if amenity == "bank":
        return "cash", "Bank"
    if amenity == "post_office":
        return "post", "Post office"
    if tags.get("railway") in {"station", "halt"} and tags.get("station") != "subway":
        return "transport", "Train station"
    if amenity == "bus_station":
        return "transport", "Bus station"
    if amenity == "ferry_terminal":
        return "transport", "Ferry terminal"
    if shop == "bicycle":
        return "bike", "Bike shop"
    if amenity == "bicycle_repair_station":
        return "bike", "Bike repair stand"
    return None


def _filters(mode: Mode) -> tuple[str, ...]:
    amenities = "|".join([*FOOD, "drinking_water", "water_point", "toilets", "shower", *HEALTH, "atm", "bank",
                          "post_office", "bus_station", "ferry_terminal", *(["bicycle_repair_station"] if mode == "cycling" else [])])
    shops = "|".join([*SHOPS, "chemist", *(["bicycle"] if mode == "cycling" else [])])
    return (f'["amenity"~"^({amenities})$"]', f'["shop"~"^({shops})$"]', '["man_made"="water_tap"]', '["railway"~"^(station|halt)$"]')


def _thin(line: Sequence[tuple[float, float]], max_points: int, tolerance_m: float) -> list[tuple[float, float]]:
    while True:
        kept = [line[i] for i in simplify(line, tolerance_m)]
        if len(kept) <= max_points:
            return kept
        tolerance_m *= 2


def route_amenities(line: Sequence[tuple[float, float]], stops: Sequence[tuple[int, float, float]], mode: Mode,
                    route_radius_km: float, stop_radius_km: float) -> tuple[list[RouteAmenity], dict[int, list[NearbyAmenity]]]:
    """Shops and utilities within a corridor along the route and within reach of each rest stop."""
    corridor = _thin(line, 150, 50)
    measure = _thin(line, 1500, 15)
    measure_cum = cumulative_km(measure)
    filters = _filters(mode)
    path = ",".join(f"{lat:.5f},{lon:.5f}" for lat, lon in corridor)
    clauses = [f"nwr(around:{route_radius_km * 1000:.0f},{path}){tags};" for tags in filters]
    clauses += [f"nwr(around:{stop_radius_km * 1000:.0f},{lat:.5f},{lon:.5f}){tags};" for _, lat, lon in stops for tags in filters]
    elements = _elements(f"[out:json][timeout:25];({''.join(clauses)});out center tags;")
    places = {place.id: place for element in elements if (place := _place(element, classify=amenity_kind))}

    along: list[RouteAmenity] = []
    for place in places.values():
        km, off = project(measure, measure_cum, place.lat, place.lon)
        if off <= route_radius_km + 0.1:
            along.append(RouteAmenity(**place.model_dump(), km=round(km, 2), off_route_km=round(off, 2)))
    along.sort(key=lambda item: item.km)

    near: dict[int, list[NearbyAmenity]] = {}
    for night, lat, lon in stops:
        found = [NearbyAmenity(**place.model_dump(), distance_km=round(distance_km(lat, lon, place.lat, place.lon), 2))
                 for place in places.values()]
        near[night] = sorted((item for item in found if item.distance_km <= stop_radius_km), key=lambda item: item.distance_km)[:40]
    return along[:250], near
