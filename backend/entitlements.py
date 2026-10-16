"""Feature flags, plans and usage limits for the voice assistant.

To make voice a paid feature later:
  1. set VOICE_PAID_ONLY=true
  2. make `plan_for()` read the user's real subscription (Stripe etc.)
Nothing else changes: the API returns reason="upgrade_required" and the frontend
shows <UpgradePrompt/>.
"""
import os
import time
from collections import defaultdict, deque
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import User, VoiceSession


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def settings() -> dict:
    """Read env on every call so tests/ops can change it without a restart."""
    return {
        "enabled": _bool("VOICE_ENABLED", True),
        "paid_only": _bool("VOICE_PAID_ONLY", False),
        "daily_minutes": _int("VOICE_FREE_DAILY_MINUTES", 15),
        "monthly_minutes": _int("VOICE_FREE_MONTHLY_MINUTES", 120),
        "max_session_seconds": _int("VOICE_MAX_SESSION_SECONDS", 20 * 60),
        "idle_timeout_seconds": _int("VOICE_IDLE_TIMEOUT_SECONDS", 120),
        "token_rate_limit": _int("VOICE_TOKEN_RATE_LIMIT", 6),       # per window
        "token_rate_window": _int("VOICE_TOKEN_RATE_WINDOW_SECONDS", 600),
        "model": os.getenv("VOICE_MODEL", "gemini-3.8-live"),
        "default_voice": os.getenv("VOICE_DEFAULT", "Sulafat"),
    }


# Prebuilt Gemini voices that suit a calm advisor (descriptions from Google's voice list).
VOICES = {
    "Sulafat": "Warm",
    "Vindemiatrix": "Gentle",
    "Achernar": "Soft",
    "Gacrux": "Mature",
    "Despina": "Smooth",
    "Achird": "Friendly",
    "Schedar": "Even",
}


def plan_for(user: User) -> str:
    """'free' or 'pro'. Placeholder until billing exists: emails in VOICE_PRO_EMAILS are pro."""
    pro = {e.strip().lower() for e in os.getenv("VOICE_PRO_EMAILS", "").split(",") if e.strip()}
    return "pro" if user.email.lower() in pro else "free"


def can_use_voice(user: User) -> tuple[bool, str | None]:
    """The single gate. Returns (allowed, reason). reason: disabled | upgrade_required."""
    s = settings()
    if not s["enabled"]:
        return False, "disabled"
    if s["paid_only"] and plan_for(user) != "pro":
        return False, "upgrade_required"
    return True, None


async def usage_minutes(user: User, db: AsyncSession, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)

    async def total(since: datetime) -> float:
        secs = (await db.execute(
            select(func.coalesce(func.sum(VoiceSession.duration_seconds), 0))
            .where(VoiceSession.user_id == user.id, VoiceSession.started_at >= since))).scalar() or 0
        return round(secs / 60, 1)

    return {"today": await total(day_start), "month": await total(month_start)}


async def remaining_minutes(user: User, db: AsyncSession) -> dict:
    """Pro users are unlimited (None). Free users get the configured daily/monthly caps."""
    s = settings()
    used = await usage_minutes(user, db)
    if plan_for(user) == "pro":
        return {"used": used, "daily_left": None, "monthly_left": None, "unlimited": True}
    return {"used": used, "unlimited": False,
            "daily_left": max(0.0, round(s["daily_minutes"] - used["today"], 1)),
            "monthly_left": max(0.0, round(s["monthly_minutes"] - used["month"], 1))}


# ---- in-memory sliding-window rate limiter (per process; use Redis if you scale out) ----
_hits: dict[tuple[str, int], deque] = defaultdict(deque)


def rate_limited(bucket: str, user_id: int, limit: int, window: int) -> int:
    """Return 0 if allowed (and record the hit), else seconds until a slot frees up."""
    now = time.monotonic()
    q = _hits[(bucket, user_id)]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return max(1, int(window - (now - q[0])))
    q.append(now)
    return 0


def reset_rate_limits() -> None:  # for tests
    _hits.clear()


__all__ = ["settings", "VOICES", "plan_for", "can_use_voice", "usage_minutes",
           "remaining_minutes", "rate_limited", "reset_rate_limits"]
