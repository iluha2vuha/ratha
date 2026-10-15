from fastapi import APIRouter

router = APIRouter(tags=["profile"])


@router.get("/profile")
def get_profile() -> dict[str, object]:
    """Walker profile. Empty until accounts exist."""
    return {
        "display_name": "",
        "routes": [],
        "friends": [],
        "photos": [],
        "stats": {},
        "badges": [],
    }
