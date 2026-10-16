"""Authentication: email/password and Google ID-token sign-in, with JWT sessions."""
import asyncio
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as g_id_token
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session
from models import User
from schemas import (
    GoogleLoginRequest, LoginRequest, SignupRequest, TokenResponse, UserOut,
)

load_dotenv()
log = logging.getLogger("wealthpilot.auth")

ALGO = "HS256"
TOKEN_TTL = timedelta(days=int(os.getenv("JWT_TTL_DAYS", "7")))
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    log.warning("JWT_SECRET is not set: using an ephemeral secret (sessions reset on restart)")

router = APIRouter(tags=["auth"])
bearer = HTTPBearer(auto_error=False)
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt())


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str | bytes) -> bool:
    try:
        h = hashed.encode() if isinstance(hashed, str) else hashed
        return bcrypt.checkpw(password.encode(), h)
    except ValueError:
        return False


def _issue_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user.id), "iat": now, "exp": now + TOKEN_TTL}, JWT_SECRET, algorithm=ALGO)


def _response(user: User) -> TokenResponse:
    return TokenResponse(access_token=_issue_token(user), user=UserOut.model_validate(user))


def verify_google_token(token: str) -> dict:
    """Validate a Google ID token (signature, expiry, issuer, audience). Raises ValueError if bad."""
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise RuntimeError("GOOGLE_CLIENT_ID not set")
    return g_id_token.verify_oauth2_token(
        token, g_requests.Request(), client_id, clock_skew_in_seconds=10)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_session),
) -> User:
    unauthorized = HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[ALGO])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = await db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user


@router.post("/auth/signup", response_model=TokenResponse, status_code=201)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_session)):
    email = body.email.lower()
    taken = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if taken:
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, name=body.name.strip(),
                password_hash=await asyncio.to_thread(_hash, body.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "An account with this email already exists")
    return _response(user)


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_session)):
    user = (await db.execute(
        select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    # Always run a bcrypt check so response time doesn't reveal whether the email exists.
    stored = user.password_hash if user and user.password_hash else _DUMMY_HASH
    ok = await asyncio.to_thread(_verify, body.password, stored)
    if not (user and user.password_hash and ok):
        raise HTTPException(401, "Invalid email or password")
    return _response(user)


@router.post("/auth/google", response_model=TokenResponse)
async def google_login(body: GoogleLoginRequest, db: AsyncSession = Depends(get_session)):
    try:
        info = await asyncio.to_thread(verify_google_token, body.credential)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except ValueError:
        raise HTTPException(401, "Invalid Google credential")
    email = (info.get("email") or "").lower()
    sub = info.get("sub")
    if not email or not sub or not info.get("email_verified"):
        raise HTTPException(401, "Google account email is not verified")

    user = (await db.execute(select(User).where(User.google_sub == sub))).scalar_one_or_none()
    if user is None:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user:  # existing password account: link it (Google verified this email)
            user.google_sub = sub
        else:
            user = User(email=email, google_sub=sub,
                        name=(info.get("name") or email.split("@")[0])[:120])
            db.add(user)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(409, "Could not create account, please retry")
    return _response(user)


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
