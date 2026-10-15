"""Small SQLite-backed email/password auth for the hackathon prototype."""

from __future__ import annotations

from contextlib import contextmanager

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Iterator, Optional

from fastapi import APIRouter, Cookie, HTTPException, Response, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/auth", tags=["authentication"])
SESSION_COOKIE = "bothybound_session"
SESSION_SECONDS = 60 * 60 * 24 * 14
PASSWORD_ROUNDS = 310_000
DB_PATH = Path(os.getenv("BOTHYBOUND_AUTH_DB", Path(__file__).resolve().parents[2] / "data" / "auth.sqlite3"))


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _initialize() -> None:
    with _connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            """
        )


_initialize()


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=80)


class User(BaseModel):
    id: int
    email: str
    display_name: str


def _email(value: str) -> str:
    normalized = value.strip().casefold()
    if normalized.count("@") != 1 or "." not in normalized.rsplit("@", 1)[1] or any(c.isspace() for c in normalized):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return normalized


def _password_hash(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ROUNDS)


def _user(row: sqlite3.Row) -> User:
    return User(id=row["id"], email=row["email"], display_name=row["display_name"])


def _set_session(response: Response, db: sqlite3.Connection, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    db.execute(
        "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (hashlib.sha256(token.encode()).hexdigest(), user_id, now + SESSION_SECONDS),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=os.getenv("BOTHYBOUND_COOKIE_SECURE", "0") == "1",
        samesite="lax",
        path="/",
    )


def _current_user(token: Optional[str], db: sqlite3.Connection) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Please sign in.")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = db.execute(
        "SELECT users.id, users.email, users.display_name FROM sessions "
        "JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
        (token_hash, int(time.time())),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Please sign in again.")
    return _user(row)


@router.post("/register", response_model=User, status_code=status.HTTP_201_CREATED)
def register(payload: Registration, response: Response) -> User:
    email = _email(payload.email)
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="Enter your name.")
    salt = secrets.token_bytes(16)
    with _connect() as db:
        try:
            cursor = db.execute(
                "INSERT INTO users(email, display_name, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (email, display_name, salt, _password_hash(payload.password, salt), int(time.time())),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from error
        user_id = cursor.lastrowid
        _set_session(response, db, user_id)
        return User(id=user_id, email=email, display_name=display_name)


@router.post("/login", response_model=User)
def login(payload: Credentials, response: Response) -> User:
    email = _email(payload.email)
    with _connect() as db:
        row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row is None or not hmac.compare_digest(_password_hash(payload.password, row["password_salt"]), row["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        _set_session(response, db, row["id"])
        return _user(row)


@router.get("/me", response_model=User)
def me(session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE)) -> User:
    with _connect() as db:
        return _current_user(session, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE)) -> Response:
    if session:
        token_hash = hashlib.sha256(session.encode()).hexdigest()
        with _connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    response.status_code = status.HTTP_204_NO_CONTENT
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    return response
