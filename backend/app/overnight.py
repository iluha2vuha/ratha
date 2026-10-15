"""Find mapped overnight accommodation near each route stage endpoint."""

from __future__ import annotations

import json
import math
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException
from pydantic import BaseModel, Field

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "BothyBound/0.1 (Scottish multi-day route planning prototype)"


class StayPoint(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class StayStage(BaseModel):
    day: int = Field(ge=1, le=60)
    points: list[StayPoint] = Field(min_length=2, max_length=10000)


class OvernightRequest(BaseModel):
    stages: list[StayStage] = Field(min_length=1, max_length=60)
    radius_m: int = Field(default=10000, ge=500, le=30000)


def _distance_km(a: StayPoint, lat: float, lon: float) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(lat)
    dlat, dlon = lat2 - lat1, math.radians(lon - a.lon)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1, max(0, value))))


def _category(tags: dict[str, str]) -> str | None:
    tourism = tags.get("tourism", "").casefold()
    name = tags.get("name", "").casefold()
    shelter = tags.get("shelter_type", "").casefold()
    if tourism in {"wilderness_hut", "alpine_hut"} or shelter == "bothy" or "bothy" in name:
        return "bothy"
    if tourism in {"camp_site", "caravan_site"}:
        return "campsite"
    if tourism in {"hostel", "hotel", "guest_house", "motel"}:
        return "indoors"
    return None


def _fetch_places(stages: list[StayStage], radius_m: int) -> list[dict]:
    # One bounded Overpass request covers all overnight endpoints on the route.
    locations = [stage.points[-1] for stage in stages[:-1]]
    if not locations:
        return []
    clauses = []
    for point in locations:
        around = f"(around:{radius_m},{point.lat:.6f},{point.lon:.6f})"
        clauses.extend([
            f'nwr{around}["tourism"~"^(camp_site|caravan_site|wilderness_hut|alpine_hut|hostel|hotel|guest_house|motel)$"];',
            f'nwr{around}["shelter_type"="bothy"];',
            f'nwr{around}["name"~"bothy",i];',
        ])
    query = "[out:json][timeout:25];(" + "".join(clauses) + ");out center tags;"
    request = Request(OVERPASS_URL, data=urlencode({"data": query}).encode(), headers={
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=35) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {429, 504}:
            raise HTTPException(503, "The OpenStreetMap places service is busy. Try again shortly.") from error
        raise HTTPException(502, "The OpenStreetMap places service returned an error.") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise HTTPException(502, "Could not reach the OpenStreetMap places service.") from error
    if not isinstance(result, dict) or not isinstance(result.get("elements"), list):
        raise HTTPException(502, "The OpenStreetMap places service returned invalid data.")
    return result["elements"]


def find_overnight_stays(payload: OvernightRequest) -> dict:
    nights = payload.stages[:-1]
    elements = _fetch_places(payload.stages, payload.radius_m)
    candidates = []
    for item in elements:
        tags = item.get("tags", {})
        category = _category(tags)
        if not category:
            continue
        center = item.get("center", item)
        try:
            lat, lon = float(center["lat"]), float(center["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        candidates.append({
            "id": f'{item.get("type", "node")}/{item.get("id", "")}',
            "name": tags.get("name") or {"bothy": "Mapped bothy", "campsite": "Mapped campsite", "indoors": "Mapped accommodation"}[category],
            "category": category,
            "lat": lat,
            "lon": lon,
            "tags": tags,
            "osm_url": f'https://www.openstreetmap.org/{item.get("type", "node")}/{item.get("id", "")}',
        })

    results = []
    for stage in nights:
        endpoint = stage.points[-1]
        stays = []
        for place in candidates:
            distance_km = _distance_km(endpoint, place["lat"], place["lon"])
            if distance_km > payload.radius_m / 1000:
                continue
            tags = place["tags"]
            stay = {key: value for key, value in place.items() if key != "tags"}
            stay["distance_km"] = round(distance_km, 1)
            for key in ("website", "contact:website", "phone", "contact:phone", "operator", "opening_hours", "fee", "access"):
                if tags.get(key):
                    stay[key.replace(":", "_")] = tags[key]
            stays.append(stay)
        stays.sort(key=lambda stay: stay["distance_km"])
        results.append({"day": stage.day, "endpoint": endpoint.model_dump(), "stays": stays[:20]})

    return {
        "nights": results,
        "radius_km": payload.radius_m / 1000,
        "source": "OpenStreetMap contributors",
        "source_url": "https://www.openstreetmap.org/copyright",
        "notice": "OpenStreetMap listings may be incomplete or out of date. Check access, opening, booking and current conditions directly. Bothy listings are not verified by the Mountain Bothies Association; campsites are mapped sites, not wild-camping recommendations. Ratings are not available.",
    }
