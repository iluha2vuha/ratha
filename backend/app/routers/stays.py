"""Rated overnight stays near a daily endpoint, from Google Places."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import google_places
from app.google_places import GooglePlacesUnavailable, RatedStay

router = APIRouter(tags=["stays"])


class NearbyStaysResponse(BaseModel):
    endpoint: Optional[str]
    lat: float
    lon: float
    stays: list[RatedStay]
    attribution: str = google_places.ATTRIBUTION


@router.get("/stays/nearby", response_model=NearbyStaysResponse)
def nearby_stays(
    endpoint: Optional[str] = Query(default=None, min_length=2, max_length=160, description="Place name to search near"),
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lon: Optional[float] = Query(default=None, ge=-180, le=180),
) -> NearbyStaysResponse:
    """Search by a named endpoint, or by coordinates when no name is given."""
    name = " ".join(endpoint.split()) if endpoint else None
    if not name and (lat is None or lon is None):
        raise HTTPException(422, "Give an endpoint name or both lat and lon.")
    if not google_places.is_configured():
        raise HTTPException(503, "Rated stays are not set up on this server. Add GOOGLE_PLACES_API_KEY to backend/.env.")
    try:
        if name:
            lat, lon = google_places.locate(name)
        stays = google_places.stays_near(lat, lon)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except GooglePlacesUnavailable as error:
        raise HTTPException(502, str(error)) from error
    return NearbyStaysResponse(endpoint=name, lat=lat, lon=lon, stays=stays)
