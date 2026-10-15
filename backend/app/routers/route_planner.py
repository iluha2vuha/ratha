"""Multi-day trip planning: routes from Valhalla, rest stops and amenities from OpenStreetMap.

A trip runs start -> must-visit places -> finish. Several routing profiles give route
options; each option gets rest stops where the daily distance goals are reached, moved
to a nearby place to stay, then is routed again through those stays.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import date
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.planner import RoutePoint
from app.route_places import NearbyAmenity, RouteAmenity, StaySearch, route_amenities
from app.routers.places import OverpassUnavailable
from app.trip_planner import (
    Mode, NamedPoint, Pace, RouteOption, STAY_KINDS, TrackPoint, TripPlan, build_option,
    cumulative_km, elevations_along, path_allowance, place_rest_stops, point_at, rough_distance_km,
    similar_tracks, visit_order,
)

router = APIRouter(tags=["route planning"])

NOMINATIM_URL = os.getenv("BOTHYBOUND_GEOCODER_URL", "https://nominatim.openstreetmap.org/search")
VALHALLA_URL = os.getenv("BOTHYBOUND_ROUTER_URL", "https://valhalla1.openstreetmap.de/route")
APP_USER_AGENT = "Ratha/0.1 (StrathHack prototype; route planning demo)"
ROUTE_ATTRIBUTION = "© OpenStreetMap contributors · Routing and elevation by Valhalla"
MAX_OPTIONS = 4
# A stay further than this from the route gets the path to it routed in.
REROUTE_OFF_ROUTE_KM = 0.15
ROUTE_CACHE_SECONDS = 600
ROUTE_INTERVAL_SECONDS = 1.0

_geocode_cache: dict[str, tuple[float, float, str]] = {}
_geocode_lock = threading.Lock()
_last_geocode_request = 0.0
_route_cache: dict[str, tuple[float, dict]] = {}
_route_lock = threading.Lock()
_last_route_request = 0.0

DailyKm = Annotated[float, Field(gt=0, le=200, allow_inf_nan=False)]
StayKind = Literal["campsite", "bothy", "hostel", "hotel", "guest_house"]
PlaceRef = str | NamedPoint


def _place_name(place: PlaceRef) -> str:
    return place.name.strip() if isinstance(place, NamedPoint) else place.strip()


def _places_blank(places: list[PlaceRef]) -> bool:
    return any(not _place_name(place) for place in places)

# (id, label, description, costing options) per travel mode, in order of preference.
PROFILES: dict[str, list[tuple[str, str, str, dict]]] = {
    "hiking": [
        ("balanced", "Balanced route", "The router's usual mix of distance, path type and hills.", {"use_ferry": 0.0}),
        ("direct", "Most direct", "The shortest walking distance the router found.", {"shortest": True, "use_ferry": 0.0}),
        ("gentle", "Gentler climbs", "Avoids hills where a flatter path exists.", {"use_hills": 0.0, "use_ferry": 0.0}),
        ("hill", "Hill paths", "Allows rougher mountain paths, up to demanding hiking trails (SAC T3). Check conditions and your navigation skills.",
         {"use_hills": 1.0, "max_hiking_difficulty": 3, "use_tracks": 1.0, "use_ferry": 0.0}),
    ],
    "cycling": [
        ("balanced", "Balanced route", "The router's usual mix of distance, road type and hills.", {"bicycle_type": "Hybrid", "use_ferry": 0.0}),
        ("direct", "Most direct", "The shortest cycling distance the router found.", {"bicycle_type": "Hybrid", "shortest": True, "use_ferry": 0.0}),
        ("gentle", "Gentler climbs", "Avoids hills where a flatter road or path exists.", {"bicycle_type": "Hybrid", "use_hills": 0.0, "use_ferry": 0.0}),
        ("tracks", "Quieter tracks", "Prefers cycle paths and tracks over roads, accepting rougher surfaces.",
         {"bicycle_type": "Mountain", "use_roads": 0.0, "avoid_bad_surfaces": 0.0, "use_ferry": 0.0}),
    ],
}


class TripSettings(BaseModel):
    mode: Mode = "hiking"
    daily_km: list[DailyKm] = Field(min_length=1, max_length=14)
    start_date: date
    pace: Pace = "steady"
    stay_radius_km: float = Field(default=8.05, ge=1, le=25, allow_inf_nan=False)
    stay_kinds: list[StayKind] = Field(default_factory=lambda: list(STAY_KINDS), min_length=1, max_length=5)

    @model_validator(mode="after")
    def unique_stay_kinds(self):
        self.stay_kinds = list(dict.fromkeys(self.stay_kinds))
        return self


class TripRequest(TripSettings):
    start: str = Field(min_length=2, max_length=160)
    finish: str = Field(min_length=2, max_length=160)
    points_of_interest: list[PlaceRef] = Field(default_factory=list, max_length=10)
    keep_order: bool = False

    @model_validator(mode="after")
    def validate_places(self):
        if _places_blank(self.points_of_interest):
            raise ValueError("Places to visit cannot be blank.")
        if self.start.strip().casefold() == self.finish.strip().casefold() and not self.points_of_interest:
            raise ValueError("Choose a different start and finish, or add a place to visit for a round trip.")
        return self


class EstimateRequest(BaseModel):
    start: str = Field(min_length=2, max_length=160)
    finish: str = Field(min_length=2, max_length=160)
    points_of_interest: list[PlaceRef] = Field(default_factory=list, max_length=10)
    keep_order: bool = False
    mode: Mode = "hiking"

    @model_validator(mode="after")
    def validate_places(self):
        if _places_blank(self.points_of_interest):
            raise ValueError("Places to visit cannot be blank.")
        if self.start.strip().casefold() == self.finish.strip().casefold() and not self.points_of_interest:
            raise ValueError("Choose a different start and finish, or add a place to visit for a round trip.")
        return self


class DistanceEstimate(BaseModel):
    start: NamedPoint
    finish: NamedPoint
    points_of_interest: list[NamedPoint]
    straight_km: float
    estimated_km: float
    path_allowance: float
    notice: str


class TrackRequest(TripSettings):
    name: str = Field(default="Imported track", min_length=1, max_length=160)
    points: list[RoutePoint] = Field(min_length=2, max_length=10000)


class AmenityStop(BaseModel):
    night: int = Field(ge=1, le=60)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class AmenitiesRequest(BaseModel):
    line: list[tuple[float, float]] = Field(min_length=2, max_length=20000)
    stops: list[AmenityStop] = Field(default_factory=list, max_length=14)
    mode: Mode = "hiking"
    route_radius_km: float = Field(default=0.5, ge=0.1, le=2)
    stop_radius_km: float = Field(default=2.0, ge=0.5, le=5)


class StopAmenities(BaseModel):
    night: int
    amenities: list[NearbyAmenity]


class AmenitiesResponse(BaseModel):
    along_route: list[RouteAmenity]
    near_stops: list[StopAmenities]
    route_radius_km: float
    stop_radius_km: float
    attribution: str = "Place data © OpenStreetMap contributors"
    notice: str = "OpenStreetMap listings can be incomplete or out of date. Check opening times before relying on a shop or water point."


def _json_request(url: str, payload: dict | None = None) -> dict | list:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"User-Agent": APP_USER_AGENT, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["X-Client-Id"] = "bothybound-hackathon-prototype"
    request = Request(url, data=data, headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 429:
            raise HTTPException(503, "The routing service is busy. Please try again shortly.") from error
        if error.code == 400 and payload is not None:
            raise HTTPException(422, "No route could be found between those places for this travel mode.") from error
        raise HTTPException(502, "The place search or routing service returned an error.") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(502, "Could not reach the place search or routing service.") from error


def _geocode(place: str) -> tuple[float, float, str]:
    global _last_geocode_request
    key = place.strip().casefold()
    if not key:
        raise HTTPException(422, "Enter both a start and finish in Scotland.")
    with _geocode_lock:
        cached = _geocode_cache.get(key)
        if cached:
            return cached
        # Nominatim asks clients of its shared public service to stay at or below 1 request/second.
        delay = 1.0 - (time.monotonic() - _last_geocode_request)
        if delay > 0:
            time.sleep(delay)
        query = place.strip()
        if "scotland" not in query.casefold():
            query += ", Scotland"
        params = urlencode({"q": query, "format": "jsonv2", "limit": 1, "countrycodes": "gb",
                            "viewbox": "-8.8,60.9,-0.7,54.6", "bounded": 1})
        _last_geocode_request = time.monotonic()
        results = _json_request(f"{NOMINATIM_URL}?{params}")
        if not isinstance(results, list) or not results:
            raise HTTPException(422, f"Could not find “{place}” in Scotland. Try a nearby town or landmark.")
        result = results[0]
        point = (float(result["lat"]), float(result["lon"]), str(result.get("display_name", place)))
        _geocode_cache[key] = point
        return point


def _route(locations: list[dict], mode: Mode, options: dict, alternates: int = 0) -> dict:
    """Call Valhalla with elevation sampling; identical requests are served from a short cache."""
    global _last_route_request
    costing = "pedestrian" if mode == "hiking" else "bicycle"
    body = {"locations": locations, "costing": costing, "costing_options": {costing: options},
            "units": "kilometers", "elevation_interval": 30, "directions_type": "none"}
    if alternates:
        body["alternates"] = alternates
    key = json.dumps(body, sort_keys=True)
    with _route_lock:
        hit = _route_cache.get(key)
        if hit and time.monotonic() - hit[0] < ROUTE_CACHE_SECONDS:
            return hit[1]
        # The public Valhalla instance is shared fair-use infrastructure; pace our calls.
        delay = ROUTE_INTERVAL_SECONDS - (time.monotonic() - _last_route_request)
        if delay > 0:
            time.sleep(delay)
        _last_route_request = time.monotonic()
    result = _json_request(VALHALLA_URL, body)
    if not isinstance(result, dict) or not result.get("trip", {}).get("legs"):
        raise HTTPException(422, "No route could be found between those places for this travel mode.")
    with _route_lock:
        _route_cache[key] = (time.monotonic(), result)
    return result


def _decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        values = []
        for _ in range(2):
            result = shift = 0
            while True:
                if index >= len(encoded):
                    raise HTTPException(502, "The routing service returned an incomplete route shape.")
                value = ord(encoded[index]) - 63
                index += 1
                result |= (value & 0x1F) << shift
                shift += 5
                if value < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        lat += values[0]
        lon += values[1]
        points.append((lat / 1_000_000, lon / 1_000_000))
    return points


def _parse_trip(trip: dict) -> tuple[list[TrackPoint], list[int]]:
    """Track points with elevation, and the index where each leg ends."""
    points: list[TrackPoint] = []
    leg_ends: list[int] = []
    try:
        for leg in trip["legs"]:
            shape = _decode_polyline6(leg["shape"])
            elevation = elevations_along(shape, leg.get("elevation") or [], float(leg.get("elevation_interval") or 30))
            for i, ((lat, lon), height) in enumerate(zip(shape, elevation)):
                if i == 0 and points and points[-1][:2] == (lat, lon):
                    continue
                points.append((lat, lon, height))
            leg_ends.append(len(points) - 1)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(502, "The routing service returned an invalid route.") from error
    if len(points) < 2:
        raise HTTPException(422, "No usable route was found between those places.")
    return points, leg_ends


def _location(lat: float, lon: float, name: str | None = None) -> dict:
    location = {"lat": round(lat, 6), "lon": round(lon, 6), "type": "break"}
    if name:
        location["name"] = name
    return location


def _night_targets(points: list[TrackPoint], goals: list[float]) -> list[tuple[float, float]]:
    """Where each night would fall if every day hit its goal exactly, to prefetch stays."""
    cum = cumulative_km(points)
    targets, total = [], 0.0
    for goal in goals[:-1]:
        total += goal
        if total >= cum[-1]:
            break
        point = point_at(points, cum, total)
        targets.append((point[0], point[1]))
    return targets


def _label(name: str) -> str:
    return name.split(",")[0].strip() or name


def _resolve_place(place: PlaceRef) -> tuple[float, float, str]:
    if isinstance(place, NamedPoint):
        return (place.lat, place.lon, place.name.strip())
    return _geocode(place)


def _ordered_places(start_name: str, finish_name: str, waypoints: list[PlaceRef], keep_order: bool
                    ) -> tuple[tuple[float, float, str], list[tuple[tuple[float, float, str], str]], tuple[float, float, str]]:
    start = _geocode(start_name)
    finish = _geocode(finish_name)
    found = [(_resolve_place(place), _place_name(place)) for place in waypoints]
    order = list(range(len(found))) if keep_order else visit_order(start[:2], [place[:2] for place, _ in found], finish[:2])
    return start, [found[i] for i in order], finish


@router.post("/route/estimate", response_model=DistanceEstimate)
def estimate_trip(request: EstimateRequest) -> DistanceEstimate:
    """Rough distance from the named places, before a full route is requested."""
    start, pois, finish = _ordered_places(request.start, request.finish, request.points_of_interest, request.keep_order)
    stops = [start[:2], *(place[:2] for place, _ in pois), finish[:2]]
    straight, estimated = rough_distance_km(stops, request.mode)
    extra = round((path_allowance(request.mode) - 1) * 100)
    return DistanceEstimate(
        start=NamedPoint(name=_label(request.start), lat=start[0], lon=start[1]),
        finish=NamedPoint(name=_label(request.finish), lat=finish[0], lon=finish[1]),
        points_of_interest=[NamedPoint(name=name, lat=place[0], lon=place[1]) for place, name in pois],
        straight_km=round(straight, 2),
        estimated_km=round(estimated, 2),
        path_allowance=path_allowance(request.mode),
        notice=(f"Straight-line distance between your places, plus {extra}% for paths and hills. "
                "This is a planning estimate, not a walked route. Plan a route for the real distance."),
    )


@router.post("/route/plan", response_model=TripPlan)
def plan_trip(request: TripRequest) -> TripPlan:
    """Plan route options from start through must-visit places to the finish, with rest stops."""
    start, pois, finish = _ordered_places(request.start, request.finish, request.points_of_interest, request.keep_order)
    base = ([_location(start[0], start[1], request.start.strip())]
            + [_location(place[0], place[1], name) for place, name in pois]
            + [_location(finish[0], finish[1], request.finish.strip())])

    candidates: list[tuple[str, str, str, dict, list[TrackPoint], list[int]]] = []
    failures: list[HTTPException] = []
    duplicates = 0
    for profile_id, label, description, options in PROFILES[request.mode]:
        try:
            result = _route(base, request.mode, options, alternates=1 if profile_id == "balanced" and not pois else 0)
        except HTTPException as error:
            failures.append(error)
            continue
        trips = [result["trip"], *(alt.get("trip") for alt in result.get("alternates") or [] if isinstance(alt, dict))]
        for index, trip in enumerate(trips):
            if not trip or not trip.get("legs"):
                continue
            points, leg_ends = _parse_trip(trip)
            if any(similar_tracks(points, other[4]) for other in candidates):
                duplicates += 1
                continue
            if index:
                candidates.append((f"{profile_id}-alt{index}", "Alternative route", "A different line the router also rates highly.", options, points, leg_ends))
            else:
                candidates.append((profile_id, label, description, options, points, leg_ends))
    if not candidates:
        raise failures[-1] if failures else HTTPException(422, "No route could be found between those places for this travel mode.")
    candidates = candidates[:MAX_OPTIONS]

    goals = list(request.daily_km)
    stays = StaySearch(request.stay_radius_km)
    stays.prefetch([target for candidate in candidates for target in _night_targets(candidate[4], goals)])

    options_out: list[RouteOption] = []
    notices: list[str] = []
    for option_id, label, description, costing, points, leg_ends in candidates:
        cum = cumulative_km(points)
        poi_marks = [(name, cum[leg_ends[i]]) for i, (_, name) in enumerate(pois)]
        nights = place_rest_stops(points, cum, goals, stays.near, request.stay_radius_km, request.stay_kinds)
        cuts = [night.end_km for night in nights]
        path_included = False
        if any(night.stay and night.stay.off_route_km > REROUTE_OFF_ROUTE_KM for night in nights):
            stops = [(km, _location(place[0], place[1], name), None) for (place, name), (_, km) in zip(pois, poi_marks)]
            stops += [(night.end_km, _location(night.stay.lat, night.stay.lon) if night.stay else _location(night.point[0], night.point[1]), night.night)
                      for night in nights]
            stops.sort(key=lambda stop: stop[0])
            try:
                rerouted, rerouted_ends = _parse_trip(_route([base[0], *(stop[1] for stop in stops), base[-1]], request.mode, costing)["trip"])
                rerouted_cum = cumulative_km(rerouted)
                cuts = [rerouted_cum[rerouted_ends[i]] for i, stop in enumerate(stops) if stop[2] is not None]
                poi_marks = [(stop[1]["name"], rerouted_cum[rerouted_ends[i]]) for i, stop in enumerate(stops) if stop[2] is None]
                points, path_included = rerouted, True
            except HTTPException:
                notices.append(f"{label}: the path to one or more places to stay could not be routed, so day distances exclude those detours.")
        options_out.append(build_option(
            option_id=option_id, label=label, description=description, points=points, night_cuts=cuts, nights=nights,
            path_included=path_included, start_name=_label(request.start), finish_name=_label(request.finish),
            poi_marks=poi_marks, goals=goals, mode=request.mode, pace=request.pace, start_date=request.start_date,
        ))
    if stays.failed:
        notices.append("Places to stay could not be checked because OpenStreetMap search did not respond. Try again shortly.")
    if duplicates and len(options_out) < MAX_OPTIONS:
        notices.append(f"Other route preferences gave the same line, so {'only one route is' if len(options_out) == 1 else f'{len(options_out)} routes are'} shown.")
    if failures:
        notices.append("Some route options could not be calculated and are not shown.")

    return TripPlan(
        name=f"{_label(request.start)} to {_label(request.finish)}", mode=request.mode,
        start=NamedPoint(name=_label(request.start), lat=start[0], lon=start[1]),
        finish=NamedPoint(name=_label(request.finish), lat=finish[0], lon=finish[1]),
        points_of_interest=[NamedPoint(name=name, lat=place[0], lon=place[1]) for place, name in pois],
        daily_km=goals, stay_radius_km=request.stay_radius_km, stay_kinds=list(request.stay_kinds),
        options=options_out, notices=notices,
        attribution=ROUTE_ATTRIBUTION,
    )


@router.post("/route/track", response_model=TripPlan)
def plan_track(request: TrackRequest) -> TripPlan:
    """Plan days and rest stops along a supplied track such as an imported GPX file."""
    points: list[TrackPoint] = []
    for point in request.points:
        if not points or points[-1][:2] != (point.lat, point.lon):
            points.append((point.lat, point.lon, point.elevation))
    if len(points) < 2 or cumulative_km(points)[-1] < 0.01:
        raise HTTPException(422, "Route must be at least 10 metres long.")
    goals = list(request.daily_km)
    stays = StaySearch(request.stay_radius_km)
    stays.prefetch(_night_targets(points, goals))
    cum = cumulative_km(points)
    nights = place_rest_stops(points, cum, goals, stays.near, request.stay_radius_km, request.stay_kinds)
    start_name = request.points[0].name or "Track start"
    finish_name = request.points[-1].name or "Track finish"
    option = build_option(
        option_id="track", label=request.name, description="Your track as supplied. Days end at the nearest point on the track to each place to stay; detours to it are not included.",
        points=points, night_cuts=[night.end_km for night in nights], nights=nights, path_included=False,
        start_name=start_name, finish_name=finish_name, poi_marks=[], goals=goals,
        mode=request.mode, pace=request.pace, start_date=request.start_date,
    )
    return TripPlan(
        name=request.name, mode=request.mode,
        start=NamedPoint(name=start_name, lat=points[0][0], lon=points[0][1]),
        finish=NamedPoint(name=finish_name, lat=points[-1][0], lon=points[-1][1]),
        points_of_interest=[], daily_km=goals, stay_radius_km=request.stay_radius_km,
        stay_kinds=list(request.stay_kinds), options=[option],
        notices=["Places to stay could not be checked because OpenStreetMap search did not respond. Try again shortly."] if stays.failed else [],
        attribution="Track supplied by you · Places © OpenStreetMap contributors",
    )


@router.post("/route/amenities", response_model=AmenitiesResponse)
def list_route_amenities(request: AmenitiesRequest) -> AmenitiesResponse:
    """Shops, food, water, toilets and other utilities along a route and near its rest stops."""
    try:
        along, near = route_amenities(request.line, [(stop.night, stop.lat, stop.lon) for stop in request.stops],
                                      request.mode, request.route_radius_km, request.stop_radius_km)
    except OverpassUnavailable as error:
        raise HTTPException(503 if error.busy else 502, "Shops and facilities could not be loaded from OpenStreetMap. Try again shortly.") from error
    return AmenitiesResponse(
        along_route=along,
        near_stops=[StopAmenities(night=night, amenities=items) for night, items in near.items()],
        route_radius_km=request.route_radius_km, stop_radius_km=request.stop_radius_km,
    )
