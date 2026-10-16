"""Tools the voice assistant can call. Every function takes the authenticated `user` and
only ever reads or writes that user's rows; the user id never comes from the model."""
from datetime import date
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import features
from models import CreditSnapshot, Goal, User
from schemas import GoalIn
from user_routes import _goal_out
from voice_prompt import TOOL_NAMES


async def get_financial_overview(user: User, db: AsyncSession, args: dict) -> dict:
    t = await features.latest_twin_row(user, db)
    if t is None:
        return {"has_data": False, "note": "No financial snapshot saved yet."}
    emis = sum(l.monthly_emi for l in t.liabilities)
    cash = sum(a.value for a in t.assets if a.kind == "cash")
    income = t.monthly_income
    surplus = income - t.monthly_expenses - t.monthly_sip - emis
    return {
        "has_data": True,
        "monthly_income": round(income),
        "monthly_expenses": round(t.monthly_expenses),
        "monthly_sip": round(t.monthly_sip),
        "monthly_emis": round(emis),
        "monthly_surplus_after_everything": round(surplus),
        "savings_rate_pct": round((income - t.monthly_expenses) / income * 100, 1) if income > 0 else None,
        "net_worth": round(t.net_worth),
        "total_assets": round(t.total_assets),
        "total_liabilities": round(t.total_liabilities),
        "cash": round(cash),
        "emergency_fund_months": round(cash / t.monthly_expenses, 1) if t.monthly_expenses > 0 else None,
        "assets": [{"kind": a.kind, "name": a.name, "value": round(a.value)} for a in t.assets][:12],
        "loans": [{"name": l.name, "outstanding": round(l.principal), "emi": round(l.monthly_emi),
                   "months_left": l.remaining_months} for l in t.liabilities][:8],
    }


async def get_goals(user: User, db: AsyncSession, args: dict) -> dict:
    rows = (await db.execute(select(Goal).where(Goal.user_id == user.id)
                             .order_by(Goal.target_date))).scalars().all()
    out = []
    for g in rows[:10]:
        o = _goal_out(g)
        out.append({"name": o.name, "target_amount": round(o.target_amount),
                    "target_date": o.target_date.isoformat(), "saved_so_far": round(o.current_saved),
                    "monthly_contribution": round(o.monthly_contribution),
                    "progress_pct": round(o.progress_pct, 1), "on_track": o.on_track,
                    "needed_monthly_to_reach_it": round(o.required_monthly_contribution)})
    return {"count": len(out), "goals": out}


async def get_credit_snapshot(user: User, db: AsyncSession, args: dict) -> dict:
    s = (await db.execute(select(CreditSnapshot).where(CreditSnapshot.user_id == user.id)
                          .order_by(CreditSnapshot.id.desc()).limit(1))).scalar_one_or_none()
    if s is None:
        return {"has_data": False, "note": "No credit snapshot saved yet. The Credit coach page can create one."}
    return {"has_data": True, "saved_on": s.created_at.date().isoformat() if s.created_at else None,
            "credit_score": s.score, "card_utilisation_pct": s.utilization_pct,
            "debt_to_income_pct": s.dti_pct, "total_card_balance": round(s.total_balance),
            "total_card_limit": round(s.total_limit)}


async def get_alerts(user: User, db: AsyncSession, args: dict) -> dict:
    t = await features.latest_twin_row(user, db)
    goals = await features._goal_outs(user, db)
    return {"alerts": [{"title": a["title"], "detail": a["detail"]}
                       for a in features.build_alerts(t, goals)][:6]}


async def upsert_savings_goal(user: User, db: AsyncSession, args: dict) -> dict:
    if args.get("user_confirmed") is not True:
        return {"status": "not_saved", "reason": "The user has not confirmed yet. Describe the goal and ask "
                                                 "'Shall I save that?' first."}
    try:
        data = GoalIn(
            name=str(args.get("name", "")).strip()[:200],
            target_amount=float(args.get("target_amount", 0)),
            target_date=date.fromisoformat(str(args.get("target_date", ""))),
            monthly_contribution=float(args.get("monthly_contribution") or 0),
            current_saved=float(args.get("current_saved") or 0))
    except (ValidationError, ValueError, TypeError) as e:
        return {"status": "not_saved", "reason": f"Invalid goal details ({type(e).__name__}). "
                                                 "Ask the user to clarify the amount or date."}
    existing = (await db.execute(
        select(Goal).where(Goal.user_id == user.id, func.lower(Goal.name) == data.name.lower())
    )).scalars().first()
    if existing:
        for k, v in data.model_dump().items():
            setattr(existing, k, v)
        goal, action = existing, "updated"
    else:
        count = (await db.execute(select(func.count()).select_from(Goal)
                                  .where(Goal.user_id == user.id))).scalar() or 0
        if count >= 50:
            return {"status": "not_saved", "reason": "Goal limit reached."}
        goal = Goal(user_id=user.id, linked_allocation={}, **data.model_dump())
        db.add(goal)
        action = "created"
    await db.commit()
    await db.refresh(goal)
    o = _goal_out(goal)
    return {"status": "saved", "action": action, "name": o.name, "on_track": o.on_track,
            "needed_monthly_to_reach_it": round(o.required_monthly_contribution)}


_HANDLERS = {
    "get_financial_overview": get_financial_overview,
    "get_goals": get_goals,
    "get_credit_snapshot": get_credit_snapshot,
    "get_alerts": get_alerts,
    "upsert_savings_goal": upsert_savings_goal,
}
assert set(_HANDLERS) == TOOL_NAMES


async def run_tool(name: str, args: dict[str, Any] | None, user: User, db: AsyncSession) -> dict:
    handler = _HANDLERS.get(name)
    if handler is None:
        return {"error": "unknown_tool"}
    try:
        return await handler(user, db, args or {})
    except Exception:  # never leak internals to the model/browser
        return {"error": "tool_failed", "note": "Could not fetch that right now."}
