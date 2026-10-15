from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["settings"])


class Settings(BaseModel):
    display_name: str = ""
    home_area: str = ""
    distance_unit: Literal["km", "mi"] = "km"
    elevation_unit: Literal["m", "ft"] = "m"
    map_style: Literal["terrain", "paper", "satellite"] = "terrain"
    trip_reminders: bool = True
    friend_activity: bool = False
    profile_visibility: Literal["public", "friends", "private"] = "friends"


_state = {"settings": Settings()}


@router.get("/settings")
def read_settings() -> Settings:
    return _state["settings"]


@router.put("/settings")
def write_settings(payload: Settings) -> Settings:
    """Kept in memory for this server process only."""
    _state["settings"] = payload
    return payload
