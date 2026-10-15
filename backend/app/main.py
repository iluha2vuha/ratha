from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import load_backend_environment
from app.routers import auth, campsites, community, health, overnight, places, planner, profile, route_planner, routes, settings, stays, weather

load_backend_environment()

app = FastAPI(title="Ratha", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://localhost:5173",
        "https://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(planner.router, prefix="/api")
app.include_router(route_planner.router, prefix="/api")
app.include_router(places.router, prefix="/api")
app.include_router(weather.router, prefix="/api")
app.include_router(overnight.router, prefix="/api")
app.include_router(stays.router, prefix="/api")
app.include_router(campsites.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(routes.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(community.router, prefix="/api")
app.include_router(settings.router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Ratha API", "docs": "/docs"}
