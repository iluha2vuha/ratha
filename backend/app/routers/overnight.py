from fastapi import APIRouter

from app.overnight import OvernightRequest, find_overnight_stays

router = APIRouter(tags=["overnight stays"])


@router.post("/overnight-stays")
def overnight_stays(payload: OvernightRequest) -> dict:
    return find_overnight_stays(payload)
