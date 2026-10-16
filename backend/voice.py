"""Voice assistant API (Gemini Live). The browser talks to Gemini directly using a short-lived,
single-use ephemeral token minted here; the real API key never leaves the server.

Flow: GET /voice/config -> POST /voice/consent (first time) -> POST /voice/session (token)
      -> [browser <-> Gemini Live]; tool calls -> POST /voice/tool
      -> POST /voice/session/{id}/end (usage + optional encrypted transcript & summary).
"""
import asyncio
import datetime as dt
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

import ai_service
import entitlements as ent
from auth import get_current_user
from database import get_session
from models import User, VoiceProfile, VoiceSession
from secure_store import decrypt_json, encrypt_json
from voice_prompt import TOOL_DECLARATIONS, build_system_prompt
from voice_tools import run_tool

router = APIRouter(prefix="/voice", tags=["voice"])
log = logging.getLogger("voice")

MAX_TURNS = 400
MAX_TURN_CHARS = 2000


def _now() -> dt.datetime:
    return dt.datetime.utcnow()


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, **extra})


# ------------------------------------------------------------------ helpers
async def _profile(user: User, db: AsyncSession, create: bool = False) -> Optional[VoiceProfile]:
    p = (await db.execute(select(VoiceProfile).where(VoiceProfile.user_id == user.id))).scalar_one_or_none()
    if p is None and create:
        p = VoiceProfile(user_id=user.id, save_history=False)
        db.add(p)
        await db.flush()
    return p


async def _close_stale(user: User, db: AsyncSession) -> None:
    """Sessions whose browser vanished never call /end; close them so minutes still count."""
    s = ent.settings()
    cutoff = _now() - dt.timedelta(seconds=s["max_session_seconds"] + 180)
    rows = (await db.execute(select(VoiceSession).where(
        VoiceSession.user_id == user.id, VoiceSession.ended_at.is_(None)))).scalars().all()
    changed = False
    for r in rows:
        if r.started_at and r.started_at < cutoff:
            r.ended_at = r.started_at + dt.timedelta(seconds=s["max_session_seconds"])
            r.duration_seconds = s["max_session_seconds"]
            r.end_reason = "abandoned"
            changed = True
    if changed:
        await db.commit()


def _mint_token(model: str, max_seconds: int) -> str:
    """Create a one-use ephemeral Live API token. Synchronous (SDK call); run in a thread."""
    from google import genai
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    client = genai.Client(api_key=key)
    now = dt.datetime.now(tz=dt.timezone.utc)
    token = client.auth_tokens.create(config={
        "uses": 1,  # one session; reconnects use session resumption with the same token
        "expire_time": now + dt.timedelta(seconds=max_seconds + 120),
        "new_session_expire_time": now + dt.timedelta(minutes=1),
        "live_connect_constraints": {
            "model": model,
            "config": {"session_resumption": {}, "response_modalities": ["AUDIO"]},
        },
    })
    return token.name


def _generate_summary(transcript: list[dict]) -> Optional[dict]:
    """Short summary + key advice + action items. Returns None on any failure."""
    if not ai_service.configured() or not transcript:
        return None
    text = "\n".join(f"{t['role']}: {t['text']}" for t in transcript)[:12000]
    try:
        out = ai_service.generate(
            "You summarise a personal-finance voice conversation for the user's own history. "
            "Return ONLY JSON: {\"summary\": string (max 60 words), \"key_advice\": string[] (max 4), "
            "\"action_items\": string[] (max 4)}. Use only facts present in the transcript; invent no numbers. "
            "Write in the language the user spoke. If the conversation was about personal safety or crisis, "
            "write only a brief, kind, non-specific summary and leave the lists empty.",
            text, 0.2)
        out = out.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        d = json.loads(out)
        return {
            "summary": str(d.get("summary", ""))[:600],
            "key_advice": [str(x)[:200] for x in (d.get("key_advice") or [])][:4],
            "action_items": [str(x)[:200] for x in (d.get("action_items") or [])][:4],
        }
    except Exception:
        log.warning("voice summary failed")
        return None


# ------------------------------------------------------------------ schemas
class ConsentIn(BaseModel):
    save_history: bool = False
    voice: Optional[str] = None


class SessionIn(BaseModel):
    voice: Optional[str] = None


class ToolIn(BaseModel):
    session_id: int
    name: str = Field(max_length=60)
    args: dict = Field(default_factory=dict)


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=MAX_TURN_CHARS)


class EndIn(BaseModel):
    language: Optional[str] = Field(None, max_length=20)
    end_reason: str = Field("user_ended", max_length=30)
    error_code: Optional[str] = Field(None, max_length=40)
    reconnects: int = Field(0, ge=0, le=50)
    transcript: list[Turn] = Field(default_factory=list, max_length=MAX_TURNS)


# ------------------------------------------------------------------ endpoints
@router.get("/config")
async def voice_config(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    s = ent.settings()
    await _close_stale(user, db)
    allowed, reason = ent.can_use_voice(user)
    p = await _profile(user, db)
    return {
        "enabled": s["enabled"], "allowed": allowed, "reason": reason, "plan": ent.plan_for(user),
        "voices": ent.VOICES, "default_voice": s["default_voice"],
        "voice": (p.voice if p and p.voice in ent.VOICES else s["default_voice"]),
        "consented": bool(p and p.consented_at), "save_history": bool(p and p.save_history),
        "limits": {"daily_minutes": s["daily_minutes"], "monthly_minutes": s["monthly_minutes"],
                   "max_session_seconds": s["max_session_seconds"],
                   "idle_timeout_seconds": s["idle_timeout_seconds"]},
        "usage": await ent.remaining_minutes(user, db),
        "available": ai_service.configured(),
    }


@router.post("/consent")
async def give_consent(body: ConsentIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_session)):
    p = await _profile(user, db, create=True)
    if p.consented_at is None:
        p.consented_at = _now()
    p.save_history = body.save_history
    if body.voice is not None:
        if body.voice not in ent.VOICES:
            raise _err(422, "bad_voice", "Unknown voice.")
        p.voice = body.voice
    await db.commit()
    return {"consented": True, "save_history": p.save_history}


@router.post("/session")
async def start_session(body: SessionIn, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_session)):
    s = ent.settings()
    allowed, reason = ent.can_use_voice(user)
    if not allowed:
        raise _err(402 if reason == "upgrade_required" else 403, reason, "Voice assistant isn't available on your plan."
                   if reason == "upgrade_required" else "The voice assistant is switched off right now.")
    p = await _profile(user, db)
    if p is None or p.consented_at is None:
        raise _err(403, "consent_required", "Please review and accept the voice privacy notice first.")
    wait = ent.rate_limited("voice_token", user.id, s["token_rate_limit"], s["token_rate_window"])
    if wait:
        raise _err(429, "rate_limited", "You're starting sessions very quickly. Please try again shortly.",
                   retry_after=wait)
    await _close_stale(user, db)
    rem = await ent.remaining_minutes(user, db)
    if not rem["unlimited"] and (rem["daily_left"] < 1 or rem["monthly_left"] < 1):
        raise _err(429, "limit_reached", "You've used your free voice minutes for now.",
                   daily_left=rem["daily_left"], monthly_left=rem["monthly_left"])
    if not ai_service.configured():
        raise _err(503, "unavailable", "Voice is temporarily unavailable.")

    voice = body.voice or p.voice or s["default_voice"]
    if voice not in ent.VOICES:
        voice = s["default_voice"]

    cap = s["max_session_seconds"]
    if not rem["unlimited"]:  # don't let one session exceed what's left today
        cap = min(cap, int(rem["daily_left"] * 60), int(rem["monthly_left"] * 60))

    memories = []
    if p.save_history:
        rows = (await db.execute(select(VoiceSession).where(
            VoiceSession.user_id == user.id, VoiceSession.summary_enc.is_not(None))
            .order_by(VoiceSession.id.desc()).limit(3))).scalars().all()
        for r in rows:
            d = decrypt_json(r.summary_enc) or {}
            if d.get("summary"):
                memories.append({"when": r.started_at.date().isoformat(), **d})

    try:
        token = await asyncio.to_thread(_mint_token, s["model"], cap)
    except Exception:
        log.exception("voice token mint failed")
        raise _err(503, "unavailable", "Voice is temporarily unavailable.")

    sess = VoiceSession(user_id=user.id, started_at=_now(), voice=voice)
    db.add(sess)
    await db.commit()
    await db.refresh(sess)
    log.info("voice_session_start user=%s session=%s voice=%s", user.id, sess.id, voice)
    return {
        "session_id": sess.id, "token": token, "model": s["model"], "voice": voice,
        "system_instruction": build_system_prompt(user.name or None, memories),
        "tools": [{"functionDeclarations": TOOL_DECLARATIONS}],
        "max_session_seconds": cap, "idle_timeout_seconds": s["idle_timeout_seconds"],
        "save_history": p.save_history,
    }


async def _owned_session(session_id: int, user: User, db: AsyncSession) -> VoiceSession:
    sess = (await db.execute(select(VoiceSession).where(
        VoiceSession.id == session_id, VoiceSession.user_id == user.id))).scalar_one_or_none()
    if sess is None:
        raise _err(404, "not_found", "Session not found.")
    return sess


@router.post("/tool")
async def call_tool(body: ToolIn, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_session)):
    sess = await _owned_session(body.session_id, user, db)
    if sess.ended_at is not None:
        raise _err(409, "session_ended", "This session has ended.")
    if ent.rate_limited("voice_tool", user.id, 60, 60):
        raise _err(429, "rate_limited", "Too many requests.")
    return {"result": await run_tool(body.name, body.args, user, db)}


@router.post("/session/{session_id}/end")
async def end_session(session_id: int, body: EndIn, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_session)):
    sess = await _owned_session(session_id, user, db)
    if sess.ended_at is not None:  # idempotent (sendBeacon + normal end may both arrive)
        return {"session_id": sess.id, "duration_seconds": sess.duration_seconds, "summary": None}
    s = ent.settings()
    now = _now()
    # Usage is measured by the server clock, never trusted from the client.
    elapsed = max(0, int((now - sess.started_at).total_seconds()))
    sess.duration_seconds = min(elapsed, s["max_session_seconds"] + 120)
    sess.ended_at = now
    sess.language = body.language
    sess.end_reason = body.end_reason
    sess.error_code = body.error_code
    sess.reconnects = body.reconnects

    p = await _profile(user, db)
    summary = None
    transcript = [t.model_dump() for t in body.transcript if t.text.strip()]
    if p and p.save_history and transcript:
        summary = await asyncio.to_thread(_generate_summary, transcript)
        sess.transcript_enc = encrypt_json(transcript)
        sess.summary_enc = encrypt_json(summary or {"summary": "", "key_advice": [], "action_items": []})
    await db.commit()
    # Analytics: counts and durations only, never content.
    log.info("voice_session_end user=%s session=%s secs=%s lang=%s reason=%s err=%s reconnects=%s",
             user.id, sess.id, sess.duration_seconds, sess.language, sess.end_reason,
             sess.error_code, sess.reconnects)
    return {"session_id": sess.id, "duration_seconds": sess.duration_seconds, "summary": summary}


def _session_out(r: VoiceSession, detail: bool = False) -> dict:
    out = {
        "id": r.id, "started_at": r.started_at.isoformat() if r.started_at else None,
        "duration_seconds": r.duration_seconds, "language": r.language, "voice": r.voice,
        "summary": decrypt_json(r.summary_enc), "has_transcript": bool(r.transcript_enc),
    }
    if detail:
        out["transcript"] = decrypt_json(r.transcript_enc) or []
    return out


@router.get("/sessions")
async def list_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(select(VoiceSession).where(
        VoiceSession.user_id == user.id, VoiceSession.ended_at.is_not(None))
        .order_by(VoiceSession.id.desc()).limit(100))).scalars().all()
    return [_session_out(r) for r in rows]


@router.get("/sessions/{session_id}")
async def get_session_detail(session_id: int, user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_session)):
    return _session_out(await _owned_session(session_id, user, db), detail=True)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: int, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_session)):
    await db.delete(await _owned_session(session_id, user, db))
    await db.commit()


@router.delete("/data", status_code=204)
async def delete_all_voice_data(user: User = Depends(get_current_user),
                                db: AsyncSession = Depends(get_session)):
    """Erase every voice session and transcript and withdraw consent."""
    await db.execute(delete(VoiceSession).where(VoiceSession.user_id == user.id))
    await db.execute(delete(VoiceProfile).where(VoiceProfile.user_id == user.id))
    await db.commit()
