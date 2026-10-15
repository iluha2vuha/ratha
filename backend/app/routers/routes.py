"""Account-owned route library stored in the auth SQLite database."""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.planner import Plan, RoutePoint
from app.routers.auth import SESSION_COOKIE, User, _connect, _current_user

router = APIRouter(tags=["routes"])


def _initialize() -> None:
    with _connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS saved_routes (
                id TEXT NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                route_json TEXT NOT NULL,
                saved_at INTEGER NOT NULL,
                PRIMARY KEY (id, user_id)
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS saved_routes_user ON saved_routes(user_id, saved_at DESC)")


_initialize()


class RouteContent(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    points: list[RoutePoint] = Field(min_length=2, max_length=10000)
    plan: Plan
    # Planner output kept alongside the itinerary; older saves hold the previous route format.
    generated: Optional[dict[str, Any]] = None


class SavedRoute(RouteContent):
    id: str
    saved_at: int


def _signed_in_user(session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE)) -> User:
    with _connect() as db:
        return _current_user(session, db)


def _get_row(db: sqlite3.Connection, route_id: str, user_id: int) -> sqlite3.Row:
    row = db.execute(
        "SELECT id, name, route_json, saved_at FROM saved_routes WHERE id = ? AND user_id = ?",
        (route_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved route not found.")
    return row


def _record(row: sqlite3.Row) -> SavedRoute:
    data = json.loads(row["route_json"])
    data["name"] = row["name"]
    return SavedRoute(id=row["id"], saved_at=row["saved_at"], **data)


@router.get("/routes", response_model=list[SavedRoute])
def list_routes(user: User = Depends(_signed_in_user)) -> list[SavedRoute]:
    with _connect() as db:
        rows = db.execute(
            "SELECT id, name, route_json, saved_at FROM saved_routes WHERE user_id = ? ORDER BY saved_at DESC LIMIT 100",
            (user.id,),
        ).fetchall()
    return [_record(row) for row in rows]


@router.get("/routes/{route_id}", response_model=SavedRoute)
def get_route(route_id: str, user: User = Depends(_signed_in_user)) -> SavedRoute:
    with _connect() as db:
        return _record(_get_row(db, route_id, user.id))


@router.put("/routes/{route_id}", response_model=SavedRoute)
def save_route(route_id: str, payload: RouteContent, user: User = Depends(_signed_in_user)) -> SavedRoute:
    if not route_id or len(route_id) > 64:
        raise HTTPException(status_code=422, detail="Invalid route ID.")
    saved_at = int(time.time() * 1000)
    data = payload.model_dump(mode="json")
    with _connect() as db:
        db.execute(
            """
            INSERT INTO saved_routes(id, user_id, name, route_json, saved_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id, user_id) DO UPDATE SET
                name = excluded.name,
                route_json = excluded.route_json,
                saved_at = excluded.saved_at
            """,
            (route_id, user.id, payload.name, json.dumps(data, separators=(",", ":")), saved_at),
        )
        row = _get_row(db, route_id, user.id)
    return _record(row)


@router.delete("/routes/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(
    route_id: str,
    user: User = Depends(_signed_in_user),
) -> Response:
    with _connect() as db:
        cursor = db.execute(
            "DELETE FROM saved_routes WHERE id = ? AND user_id = ?",
            (route_id, user.id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Saved route not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
