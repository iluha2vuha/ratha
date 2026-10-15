from fastapi import APIRouter

router = APIRouter(tags=["community"])


@router.get("/community")
def list_posts() -> dict[str, list[object]]:
    """Community feed. Empty until posts are stored."""
    return {"posts": []}
