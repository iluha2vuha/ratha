"""Wild-camping suitability estimates from nearby landscape imagery.

Live mode combines Geograph's documented syndicator API with a local CLIP model.
The default mock providers keep the hackathon demo usable until both credentials and
the optional local model dependencies are installed.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import logging
from math import asin, cos, radians, sin, sqrt
import os
import re
import ssl
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(tags=["campsites"])
logger = logging.getLogger(__name__)

GEOGRAPH_SYNDICATOR_URL = "https://api.geograph.org.uk/syndicator.php"
GEOGRAPH_USER_AGENT = "BothyBound/0.1 (StrathHack demo; https://github.com/SAS-StrathHack26/team-5)"
GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
MAX_IMAGES = 3
CLIP_PROMPTS = {
    "flatOpen": "a flat, open area of ground suitable for pitching a small tent",
    "grassLowVegetation": "short grass or low vegetation suitable for pitching a small tent",
    "steep": "a steep slope or hillside unsuitable for pitching a tent",
    "rocky": "rocky uneven ground unsuitable for pitching a tent",
    "boggyWet": "boggy, wet or waterlogged ground unsuitable for pitching a tent",
    "denseVegetation": "dense shrubs, trees or thick vegetation unsuitable for pitching a tent",
    "exposed": "an exposed, windswept ridge or open hillside",
}


class TerrainSignals(BaseModel):
    flatOpen: float
    grassLowVegetation: float
    steep: float
    rocky: float
    boggyWet: float
    denseVegetation: float
    exposed: float


class ImageAssessment(BaseModel):
    """The explainable terrain estimate for one source photograph."""

    score: int
    category: Literal["Poor", "Moderate", "Promising"]
    positives: list[str]
    cautions: list[str]
    signals: TerrainSignals


class SampledImage(BaseModel):
    id: str
    title: str
    imageUrl: str | None = None
    sourceUrl: str | None = None
    credit: str | None = None
    distanceKm: float | None = None
    assessment: ImageAssessment


class PlaceLocation(BaseModel):
    latitude: float
    longitude: float
    locationName: str


class WildCampingSuitability(BaseModel):
    latitude: float
    longitude: float
    locationName: str | None = None
    score: int
    category: Literal["Poor", "Moderate", "Promising"]
    positives: list[str]
    cautions: list[str]
    imageCount: int
    sampledImages: list[SampledImage]
    imageProvider: str
    visionProvider: str
    isDemo: bool
    disclaimer: str


@dataclass(frozen=True)
class NearbyImage:
    id: str
    title: str
    image_url: str | None
    source_url: str | None
    credit: str | None = None
    demo_index: int = 0
    latitude: float | None = None
    longitude: float | None = None


class GeographError(Exception):
    """The official Geograph API could not supply usable nearby imagery."""


class LocationSearchError(Exception):
    """Google Places could not resolve a typed campsite-search location."""


def _urlopen(request: Request, timeout: int = 12) -> Any:
    context = ssl.create_default_context(cafile=certifi.where())
    return urlopen(request, timeout=timeout, context=context)


def _mock_images(latitude: float, longitude: float) -> list[NearbyImage]:
    location_key = f"{latitude:.5f},{longitude:.5f}"
    return [
        NearbyImage(
            id=f"demo-{location_key}-{index}",
            title=f"Demo nearby landscape image {index + 1}",
            image_url=None,
            source_url=None,
            credit=None,
            demo_index=index,
        )
        for index in range(MAX_IMAGES)
    ]


def _resolve_location(place: str) -> tuple[float, float, str]:
    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Place search is not configured. Set GOOGLE_PLACES_API_KEY on the backend.")

    request = Request(
        GOOGLE_PLACES_URL,
        data=json.dumps({"textQuery": place, "pageSize": 1, "languageCode": "en"}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "places.displayName,places.location",
        },
        method="POST",
    )
    try:
        with _urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.warning("Google Places location search failed: %s", type(error).__name__)
        raise LocationSearchError from error

    places = payload.get("places", [])
    location = places[0].get("location") if places else None
    if not isinstance(location, dict) or not {"latitude", "longitude"} <= location.keys():
        raise HTTPException(status_code=404, detail="Google Places could not find that location")
    display_name = places[0].get("displayName", {}).get("text")
    return float(location["latitude"]), float(location["longitude"]), str(display_name or place)


def _feed_items(payload: Any) -> list[dict[str, Any]]:
    """Accept the common JSON feed shapes returned by Geograph's syndicator API."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ("items", "images", "photos", "entries"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    channel = payload.get("channel")
    if isinstance(channel, dict):
        value = channel.get("item") or channel.get("items")
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _image_url(item: dict[str, Any]) -> str | None:
    for key in ("image", "image_url", "thumbnail", "thumb", "media:thumbnail", "media_content"):
        value = item.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            return value
        if isinstance(value, dict):
            for nested_key in ("url", "src", "href"):
                nested_value = value.get(nested_key)
                if isinstance(nested_value, str) and nested_value.startswith("https://"):
                    return nested_value

    description = item.get("description")
    if isinstance(description, str):
        match = re.search(r'<img[^>]+src=["\']([^"\']+)', description, flags=re.IGNORECASE)
        if match and match.group(1).startswith("https://"):
            return match.group(1)
    return None


def _image_credit(item: dict[str, Any]) -> str | None:
    for key in ("author", "creator", "dc:creator", "credit", "user"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            for nested_key in ("name", "text", "title"):
                nested_value = value.get(nested_key)
                if isinstance(nested_value, str) and nested_value.strip():
                    return nested_value.strip()
    return None


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _image_coordinates(item: dict[str, Any]) -> tuple[float | None, float | None]:
    """Read coordinates from the common JSON/GeoRSS fields in syndicator feeds."""
    latitude = _number(item.get("latitude") or item.get("lat") or item.get("geo:lat"))
    longitude = _number(item.get("longitude") or item.get("lng") or item.get("long") or item.get("geo:long"))
    if latitude is not None and longitude is not None:
        return latitude, longitude

    point = item.get("georss:point") or item.get("point")
    if isinstance(point, str):
        parts = point.replace(",", " ").split()
        if len(parts) >= 2:
            return _number(parts[0]), _number(parts[1])

    location = item.get("location")
    if isinstance(location, dict):
        return (
            _number(location.get("latitude") or location.get("lat")),
            _number(location.get("longitude") or location.get("lng") or location.get("long")),
        )
    return None, None


def _distance_km(latitude: float, longitude: float, other_latitude: float | None, other_longitude: float | None) -> float | None:
    if other_latitude is None or other_longitude is None:
        return None
    latitude_delta = radians(other_latitude - latitude)
    longitude_delta = radians(other_longitude - longitude)
    a = sin(latitude_delta / 2) ** 2 + cos(radians(latitude)) * cos(radians(other_latitude)) * sin(longitude_delta / 2) ** 2
    return round(6371.0088 * 2 * asin(sqrt(a)), 2)


def _geograph_images(latitude: float, longitude: float, api_key: str) -> list[NearbyImage]:
    params = urlencode(
        {
            "key": api_key,
            "format": "JSON",
            "location": f"{latitude:.6f},{longitude:.6f}",
            "distance": "2",
            "perpage": str(MAX_IMAGES),
            "expand": "1",
        },
    )
    request = Request(
        f"{GEOGRAPH_SYNDICATOR_URL}?{params}",
        headers={"Accept": "application/json", "User-Agent": GEOGRAPH_USER_AGENT},
    )
    try:
        with _urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.warning("Geograph nearby-image request failed: %s", type(error).__name__)
        raise GeographError from error

    images: list[NearbyImage] = []
    for index, item in enumerate(_feed_items(payload)[:MAX_IMAGES]):
        thumbnail_url = _image_url(item)
        if not thumbnail_url:
            continue
        image_id = str(item.get("id") or item.get("guid") or f"geograph-{index}")
        title = str(item.get("title") or "Geograph landscape image")
        source_url = item.get("link") if isinstance(item.get("link"), str) else None
        if source_url is None and image_id.isdigit():
            source_url = f"https://www.geograph.org.uk/photo/{image_id}"
        image_latitude, image_longitude = _image_coordinates(item)
        images.append(
            NearbyImage(
                image_id,
                title,
                thumbnail_url,
                source_url,
                _image_credit(item),
                index,
                image_latitude,
                image_longitude,
            )
        )
    return images


def _demo_signals(latitude: float, longitude: float, image: NearbyImage) -> TerrainSignals:
    digest = sha256(f"{latitude:.5f}:{longitude:.5f}:{image.demo_index}".encode()).digest()
    fraction = lambda index: digest[index] / 255
    return TerrainSignals(
        flatOpen=0.62 + fraction(0) * 0.30,
        grassLowVegetation=0.55 + fraction(1) * 0.35,
        steep=0.06 + fraction(2) * 0.34,
        rocky=0.05 + fraction(3) * 0.32,
        boggyWet=0.08 + fraction(4) * 0.40,
        denseVegetation=0.03 + fraction(5) * 0.24,
        exposed=0.12 + fraction(6) * 0.42,
    )


class ClipTerrainAnalyser:
    """Lazy optional CLIP adapter; dependencies and weights are not bundled by default."""

    name = "pretrained CLIP"

    def __init__(self) -> None:
        try:
            import torch  # type: ignore[import-not-found]
            from PIL import Image  # type: ignore[import-not-found]
            from transformers import CLIPModel, CLIPProcessor  # type: ignore[import-not-found]
        except ImportError as error:
            raise RuntimeError("Install backend/requirements-ai.txt to enable CLIP") from error

        self.torch = torch
        self.image_class = Image
        model_name = os.getenv("CLIP_MODEL", "openai/clip-vit-base-patch32")
        self.processor = CLIPProcessor.from_pretrained(model_name)
        self.model = CLIPModel.from_pretrained(model_name)
        self.prompts = list(CLIP_PROMPTS.values())
        self.keys = list(CLIP_PROMPTS.keys())

    def analyse(self, image: NearbyImage, latitude: float, longitude: float) -> TerrainSignals:
        if not image.image_url:
            raise RuntimeError("CLIP needs an image URL")
        request = Request(image.image_url, headers={"User-Agent": "BothyBound/0.1"})
        try:
            with _urlopen(request) as response:
                photograph = self.image_class.open(BytesIO(response.read())).convert("RGB")
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            raise RuntimeError("Could not download a Geograph image") from error

        inputs = self.processor(text=self.prompts, images=photograph, return_tensors="pt", padding=True)
        with self.torch.no_grad():
            logits = self.model(**inputs).logits_per_image[0]
        probabilities = logits.softmax(dim=0).tolist()
        return TerrainSignals(**dict(zip(self.keys, probabilities, strict=True)))


def _combine_signals(signals: list[TerrainSignals]) -> TerrainSignals:
    count = len(signals)
    return TerrainSignals(
        **{
            name: sum(getattr(signal, name) for signal in signals) / count
            for name in TerrainSignals.model_fields
        },
    )


def _score(signals: TerrainSignals) -> int:
    raw_score = (
        68
        + 20 * signals.flatOpen
        + 10 * signals.grassLowVegetation
        - 22 * signals.steep
        - 16 * signals.rocky
        - 24 * signals.boggyWet
        - 12 * signals.denseVegetation
        - 7 * signals.exposed
    )
    return max(0, min(100, round(raw_score)))


def _category(score: int) -> Literal["Poor", "Moderate", "Promising"]:
    if score < 40:
        return "Poor"
    if score < 70:
        return "Moderate"
    return "Promising"


def _explanation(signals: TerrainSignals) -> tuple[list[str], list[str]]:
    positives: list[str] = []
    cautions: list[str] = []
    if signals.flatOpen >= 0.55:
        positives.append("Flat/open terrain")
    if signals.grassLowVegetation >= 0.55:
        positives.append("Grass/low vegetation")
    if signals.rocky < 0.35:
        positives.append("Little rocky terrain")
    if signals.denseVegetation < 0.30:
        positives.append("Sparse vegetation")
    if signals.boggyWet >= 0.35:
        cautions.append("Possible wet ground")
    if signals.steep >= 0.35:
        cautions.append("Possible steep terrain")
    if signals.rocky >= 0.40:
        cautions.append("Possible rocky or uneven ground")
    if signals.denseVegetation >= 0.40:
        cautions.append("Possible dense vegetation")
    if signals.exposed >= 0.45:
        cautions.append("Possible exposed terrain")
    if not positives:
        positives.append("Mixed terrain signals")
    if not cautions:
        cautions.append("Check ground conditions in person")
    return positives, cautions


@router.get("/campsites/resolve", response_model=PlaceLocation)
def resolve_wild_campsite_place(place: str = Query(min_length=2, max_length=120)) -> PlaceLocation:
    """Resolve a typed map-search location before the client performs its land check."""
    try:
        latitude, longitude, location_name = _resolve_location(" ".join(place.split()))
    except LocationSearchError:
        raise HTTPException(status_code=502, detail="Google Places location search is temporarily unavailable") from None
    return PlaceLocation(latitude=latitude, longitude=longitude, locationName=location_name)


@router.get("/campsites/suitability", response_model=WildCampingSuitability)
def assess_wild_campsite(
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    place: str | None = Query(default=None, min_length=2, max_length=120),
) -> WildCampingSuitability:
    """Estimate terrain suitability from map coordinates or a typed place search."""
    location_name: str | None = None
    normalised_place = " ".join(place.split()) if place else ""
    if normalised_place:
        try:
            latitude, longitude, location_name = _resolve_location(normalised_place)
        except LocationSearchError:
            raise HTTPException(status_code=502, detail="Google Places location search is temporarily unavailable") from None
    elif latitude is None or longitude is None:
        raise HTTPException(status_code=422, detail="Provide latitude and longitude, or a place to search")

    assert latitude is not None and longitude is not None
    geograph_key = os.getenv("GEOGRAPH_API_KEY")
    images: list[NearbyImage]
    image_provider = "Mock Geograph provider"
    is_demo = True

    if geograph_key:
        try:
            images = _geograph_images(latitude, longitude, geograph_key)
            if images:
                image_provider = "Geograph API"
            else:
                images = _mock_images(latitude, longitude)
        except GeographError:
            images = _mock_images(latitude, longitude)
    else:
        images = _mock_images(latitude, longitude)

    analyser: ClipTerrainAnalyser | None = None
    vision_provider = "Mock terrain analyser"
    if image_provider == "Geograph API" and os.getenv("WILD_CAMP_VISION_PROVIDER", "mock").lower() == "clip":
        try:
            analyser = ClipTerrainAnalyser()
            vision_provider = analyser.name
            is_demo = False
        except RuntimeError as error:
            logger.info("CLIP is unavailable; using mock terrain analyser: %s", error)

    signals: list[TerrainSignals] = []
    per_image_assessments: list[ImageAssessment] = []
    for image in images[:MAX_IMAGES]:
        image_signals: TerrainSignals
        if analyser:
            try:
                image_signals = analyser.analyse(image, latitude, longitude)
            except RuntimeError as error:
                logger.warning("Image analysis failed; using mock result: %s", error)
                vision_provider = "Mock terrain analyser"
                is_demo = True
                image_signals = _demo_signals(latitude, longitude, image)
        else:
            image_signals = _demo_signals(latitude, longitude, image)
        signals.append(image_signals)
        image_score = _score(image_signals)
        image_positives, image_cautions = _explanation(image_signals)
        per_image_assessments.append(
            ImageAssessment(
                score=image_score,
                category=_category(image_score),
                positives=image_positives,
                cautions=image_cautions,
                signals=image_signals,
            )
        )

    if not signals:
        raise HTTPException(status_code=502, detail="No nearby imagery is available for this location")

    combined = _combine_signals(signals)
    positives, cautions = _explanation(combined)
    return WildCampingSuitability(
        latitude=latitude,
        longitude=longitude,
        locationName=location_name,
        score=_score(combined),
        category=_category(_score(combined)),
        positives=positives,
        cautions=cautions,
        imageCount=len(images),
        sampledImages=[
            SampledImage(
                id=image.id,
                title=image.title,
                imageUrl=image.image_url,
                sourceUrl=image.source_url,
                credit=image.credit,
                distanceKm=_distance_km(latitude, longitude, image.latitude, image.longitude),
                assessment=per_image_assessments[index],
            )
            for index, image in enumerate(images[:MAX_IMAGES])
        ],
        imageProvider=image_provider,
        visionProvider=vision_provider,
        isDemo=is_demo,
        disclaimer=(
            "Estimated suitability only, not a guarantee of campsite safety, ground conditions, access, weather, "
            "flood risk, landowner permission, or legal right to camp."
        ),
    )
