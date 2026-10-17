"""Feature routes: AI copilot, explainers, tutor, insights, planners, dashboard, alerts, sharing, imports."""
import asyncio
import logging
import os
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import ai_service, engine, insights, intent, mailer, narrator, planners
from auth import get_current_user, get_optional_user
from database import get_session
from feature_schemas import (
    CopilotRequest, CopilotResponse, ImportRequest, InsightsRequest, LoanVsInvestReq, PrefsIn, PrefsOut,
    RetirementReq, ShareRequest, StepUpReq, TutorRequest,
)
from models import Asset, AuditLog, FinancialTwin, Goal, Liability, SharedScenario, User
from parsers.bank_statement import parse_csv, parse_statement
from parsers.cas_parser import extract_text
from schemas import SimulationRequest, SimulationResponse, TwinInput
from user_routes import _goal_out, _owned_goal

log = logging.getLogger("wealthpilot.features")
router = APIRouter(tags=["features"])
MAX_UPLOAD = 5 * 1024 * 1024
MAX_SHARES_PER_USER = 50


# ---------------- helpers ----------------
async def read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is too large (max 5 MB)")
    if not data:
        raise HTTPException(400, "File is empty")
    return data


async def latest_twin_row(user: User, db: AsyncSession) -> FinancialTwin | None:
    return (await db.execute(
        select(FinancialTwin).where(FinancialTwin.user_id == user.id)
        .order_by(FinancialTwin.version_id.desc()).limit(1)
        .options(selectinload(FinancialTwin.assets), selectinload(FinancialTwin.liabilities))
    )).scalar_one_or_none()


def twin_input_from(t: FinancialTwin | None) -> tuple[TwinInput, list[str]]:
    if t is None:
        return (TwinInput(current_corpus=500000, monthly_sip=20000, annual_return=0.12, years=10),
                ["No saved twin yet, so sample numbers were used: corpus 500000, monthly SIP 20000, "
                 "return 12% a year."])
    investable = sum(a.value for a in t.assets if a.kind != "real_estate")
    return TwinInput(current_corpus=investable, monthly_sip=t.monthly_sip,
                     annual_return=min(max(t.annual_return, -0.5), 1.0), years=10), []


def tutor_values(t: FinancialTwin | None) -> dict:
    if t is None:
        return {"income": 0, "expenses": 0, "sip": 0, "corpus": 0, "ret": 0.12, "cash": 0, "used_sample": True}
    return {"income": t.monthly_income, "expenses": t.monthly_expenses, "sip": t.monthly_sip,
            "corpus": sum(a.value for a in t.assets if a.kind != "real_estate"),
            "ret": min(max(t.annual_return, -0.5), 1.0),
            "cash": sum(a.value for a in t.assets if a.kind == "cash"), "used_sample": False}


async def audit(db: AsyncSession, payload: dict) -> None:
    db.add(AuditLog(kind="ai", payload=payload))
    await db.commit()


# ---------------- AI copilot ----------------
async def _parse_intent(q: str):
    if ai_service.configured():
        try:
            return await asyncio.to_thread(ai_service.parse_intent_llm, q), "ai"
        except Exception:
            log.exception("LLM intent parsing failed; using rules")
    return intent.parse_rules(q), "rules"


@router.post("/ai/copilot", response_model=CopilotResponse)
async def copilot(req: CopilotRequest, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_session)):
    q = req.query.strip()
    if intent.ADVICE_RE.search(q):  # deterministic guardrail before any model is involved
        await audit(db, {"user_id": user.id, "kind": "copilot", "query": q, "refused": True})
        return CopilotResponse(refused=True, message=intent.REFUSAL)
    if intent.GREET_RE.match(q) and not any(ch.isdigit() for ch in q):
        return CopilotResponse(message=intent.GREETING, parsed_by="rules")
    parsed, parsed_by = await _parse_intent(q)
    if parsed.refused:
        await audit(db, {"user_id": user.id, "kind": "copilot", "query": q, "refused": True})
        return CopilotResponse(refused=True, message=parsed.message or intent.REFUSAL, parsed_by=parsed_by)
    scenario, notes = intent.scenario_from_params(parsed.params) if parsed.params else (None, [])
    if scenario is None:
        return CopilotResponse(message=parsed.message or intent.HINT, parsed_by=parsed_by)

    base, base_notes = twin_input_from(await latest_twin_row(user, db))
    baseline, results = engine.simulate(base, [scenario])
    facts, template = narrator.scenario_summary(base, [scenario], baseline, results, notes + base_notes)
    text, source = await asyncio.to_thread(narrator.narrate, "scenario", facts, template, True)
    await audit(db, {"user_id": user.id, "kind": "copilot", "query": q, "scenario": scenario.model_dump(),
                     "source": source})
    return CopilotResponse(scenario=scenario, assumptions=notes + base_notes,
                           simulation=SimulationResponse(baseline=baseline, scenarios=results),
                           explanation=text, source=source, parsed_by=parsed_by)


@router.post("/explain/scenario")
async def explain_scenario(req: SimulationRequest, user: User | None = Depends(get_optional_user)):
    """'Why did this change?' Anonymous callers get the deterministic summary; logged-in users get AI wording."""
    if len(req.scenarios) > 4:
        raise HTTPException(422, "At most 4 scenarios")
    baseline, results = engine.simulate(req.twin, req.scenarios)
    facts, template = narrator.scenario_summary(req.twin, req.scenarios, baseline, results, [])
    text, source = await asyncio.to_thread(narrator.narrate, "scenario", facts, template, user is not None)
    return {"explanation": text, "source": source}


@router.post("/ai/tutor")
async def tutor(req: TutorRequest, user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_session)):
    facts, template = narrator.tutor_lesson(req.term, tutor_values(await latest_twin_row(user, db)))
    text, source = await asyncio.to_thread(
        narrator.narrate, f"tutor:{req.term}", facts, template, True, narrator.DEFINITIONS[req.term])
    return {"term": req.term, "definition": narrator.DEFINITIONS[req.term], "explanation": text,
            "source": source, "facts": facts}


@router.post("/ai/insights")
async def spending_insights(req: InsightsRequest, user: User = Depends(get_current_user)):
    facts = insights.spending_facts([t.model_dump() for t in req.transactions])
    facts, template = narrator.insights_summary(facts)
    text, source = await asyncio.to_thread(narrator.narrate, "spending", facts, template, bool(facts.get("months")))
    return {"facts": facts, "explanation": text, "source": source}


# ---------------- planners ----------------
@router.post("/planners/stepup")
async def planner_stepup(req: StepUpReq, user: User | None = Depends(get_optional_user)):
    res = planners.stepup_projection(req.current_corpus, req.monthly_sip, req.step_up_pct / 100,
                                     req.annual_return_pct / 100, req.years)
    facts, template = narrator.stepup_summary(req, res)
    text, source = await asyncio.to_thread(narrator.narrate, "step_up_sip", facts, template, user is not None)
    return {"result": res, "explanation": text, "source": source}


@router.post("/planners/retirement")
async def planner_retirement(req: RetirementReq, user: User | None = Depends(get_optional_user)):
    res = planners.retirement_plan(
        req.current_age, req.retirement_age, req.life_expectancy, req.monthly_expenses, req.inflation_pct / 100,
        req.pre_return_pct / 100, req.post_return_pct / 100, req.current_corpus, req.monthly_sip,
        req.step_up_pct / 100)
    facts, template = narrator.retirement_summary(req, res)
    text, source = await asyncio.to_thread(narrator.narrate, "retirement", facts, template, user is not None)
    return {"result": res, "explanation": text, "source": source}


@router.post("/planners/loan-vs-invest")
async def planner_loan(req: LoanVsInvestReq, user: User | None = Depends(get_optional_user)):
    res = planners.loan_vs_invest(req.principal, req.annual_rate_pct / 100, req.remaining_months, req.emi,
                                  req.lump_sum, req.extra_monthly, req.invest_return_pct / 100)
    facts, template = narrator.loan_summary(req, res)
    text, source = await asyncio.to_thread(narrator.narrate, "loan_vs_invest", facts, template, user is not None)
    return {"result": res, "explanation": text, "source": source}


# ---------------- goal risk (Monte Carlo) ----------------
@router.get("/goals/{goal_id}/risk")
async def goal_risk(goal_id: int, volatility: float = Query(0.15, ge=0, le=0.6),
                    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    g = await _owned_goal(goal_id, user, db)
    status = engine.goal_status(g.target_amount, g.inflation_rate, g.current_saved or 0.0,
                                g.monthly_contribution or 0.0,
                                g.expected_return if g.expected_return is not None else 0.10, g.target_date)
    mc = await asyncio.to_thread(
        planners.monte_carlo_goal, g.current_saved or 0.0, g.monthly_contribution or 0.0,
        g.expected_return if g.expected_return is not None else 0.10, volatility,
        round(status["years_left"] * 12), status["inflated_target"])
    facts, template = narrator.risk_summary(g.name, mc, status)
    text, source = await asyncio.to_thread(narrator.narrate, "goal_risk", facts, template, True)
    return {"goal_id": g.id, "name": g.name, "probability_pct": round(mc["probability"] * 100, 1),
            "inflated_target": mc["target"], "p10": mc["p10"], "p50": mc["p50"], "p90": mc["p90"],
            "paths": mc["paths"], "volatility": volatility, "fan": mc["fan"],
            "explanation": text, "source": source}


# ---------------- dashboard, alerts, preferences ----------------
def build_alerts(t: FinancialTwin | None, goals: list, now: datetime | None = None) -> list[dict]:
    now = now or datetime.utcnow()
    if t is None:
        return [{"id": "no_twin", "severity": "info", "title": "Save your first twin snapshot",
                 "detail": "Add income, assets and liabilities on the My Twin page to unlock your health score."}]
    out: list[dict] = []
    created = t.created_at.replace(tzinfo=None) if t.created_at else now
    age = (now - created).days
    if age > 35:
        out.append({"id": "stale", "severity": "info", "title": "Your twin is out of date",
                    "detail": f"Your last snapshot is {age} days old. Save a fresh one to keep your timeline accurate."})
    emis = sum(l.monthly_emi for l in t.liabilities)
    cash = sum(a.value for a in t.assets if a.kind == "cash")
    if t.monthly_expenses > 0:
        months = cash / t.monthly_expenses
        if months < 3:
            out.append({"id": "emergency", "severity": "warning", "title": "Emergency fund is low",
                        "detail": f"Cash covers {months:.1f} months of expenses; a common benchmark is 6."})
    if t.monthly_income > 0:
        dti = emis / t.monthly_income
        if dti > 0.4:
            out.append({"id": "dti", "severity": "warning", "title": "High debt-to-income ratio",
                        "detail": f"EMIs take {dti * 100:.0f}% of income; below 40% is generally considered comfortable."})
        if t.monthly_income - t.monthly_expenses - t.monthly_sip - emis < 0:
            out.append({"id": "deficit", "severity": "warning", "title": "Monthly outflow exceeds income",
                        "detail": "Expenses, EMIs and SIP add up to more than your income."})
    for g in goals:
        if not g.on_track:
            out.append({"id": f"goal_{g.id}", "severity": "warning", "title": f"Goal behind: {g.name}",
                        "detail": f"Projected shortfall {planners.fmt_inr(g.shortfall)}. Reaching it needs about "
                                  f"{planners.fmt_inr(g.required_monthly_contribution)} a month; you save "
                                  f"{planners.fmt_inr(g.monthly_contribution)}."})
    return out


async def _goal_outs(user: User, db: AsyncSession) -> list:
    rows = (await db.execute(select(Goal).where(Goal.user_id == user.id))).scalars().all()
    return [_goal_out(g) for g in rows]


@router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    t = await latest_twin_row(user, db)
    goals = await _goal_outs(user, db)
    health = None
    if t is not None:
        emis = sum(l.monthly_emi for l in t.liabilities)
        liquid = sum(a.value for a in t.assets if a.kind == "cash")
        health = planners.health_score(t.monthly_income, t.monthly_expenses, emis, liquid, len(goals),
                                       sum(1 for g in goals if g.on_track))
    return {"has_twin": t is not None, "health": health, "alerts": build_alerts(t, goals),
            "goals_total": len(goals), "net_worth": t.net_worth if t else None,
            "version_id": t.version_id if t else None}


@router.get("/me/preferences", response_model=PrefsOut)
async def get_prefs(user: User = Depends(get_current_user)):
    return PrefsOut(email_alerts=bool(user.email_alerts), email_configured=mailer.is_configured())


@router.put("/me/preferences", response_model=PrefsOut)
async def put_prefs(body: PrefsIn, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_session)):
    user.email_alerts = body.email_alerts
    db.add(user)
    await db.commit()
    return PrefsOut(email_alerts=body.email_alerts, email_configured=mailer.is_configured())


@router.post("/alerts/send-digest")
async def send_digest(x_cron_secret: Optional[str] = Header(None), db: AsyncSession = Depends(get_session)):
    """Called by a scheduler (see .github/workflows/alerts.yml). Emails opted-in users who have warnings."""
    secret = os.getenv("CRON_SECRET")
    if not secret:
        raise HTTPException(503, "Alert digests are not enabled")
    if not x_cron_secret or not secrets.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(401, "Invalid secret")
    if not mailer.is_configured():
        raise HTTPException(503, "SMTP is not configured")
    users = (await db.execute(select(User).where(User.email_alerts.is_(True)))).scalars().all()
    sent = failed = 0
    for u in users:
        alerts = [a for a in build_alerts(await latest_twin_row(u, db), await _goal_outs(u, db))
                  if a["severity"] != "info"]
        if not alerts:
            continue
        body = ("Hi,\n\nHere are the items worth a look in WealthPilot:\n\n"
                + "\n".join(f"- {a['title']}: {a['detail']}" for a in alerts)
                + "\n\nThis is an educational summary, not investment advice. "
                  "You can turn these emails off on your dashboard.\n")
        try:
            await asyncio.to_thread(mailer.send_email, u.email, "Your WealthPilot check-in", body)
            sent += 1
        except Exception:
            log.exception("digest email failed")
            failed += 1
    return {"opted_in": len(users), "sent": sent, "failed": failed}


# ---------------- shareable scenarios ----------------
def _thin(r) -> dict:
    return {"name": r.name, "final_corpus": r.final_corpus,
            "series": [p.model_dump() for p in r.series if p.month % 6 == 0]}


@router.post("/share", status_code=201)
async def create_share(req: ShareRequest, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_session)):
    count = (await db.execute(
        select(func.count()).select_from(SharedScenario).where(SharedScenario.user_id == user.id))).scalar() or 0
    if count >= MAX_SHARES_PER_USER:
        raise HTTPException(429, "Share limit reached. Delete an old link first.")
    baseline, results = engine.simulate(req.twin, req.scenarios)
    _, template = narrator.scenario_summary(req.twin, req.scenarios, baseline, results, [])
    payload = {"title": req.title, "twin": req.twin.model_dump(),
               "scenarios": [s.model_dump() for s in req.scenarios],
               "baseline": _thin(baseline), "results": [_thin(r) for r in results], "explanation": template}
    token = secrets.token_urlsafe(12)
    db.add(SharedScenario(token=token, user_id=user.id, title=req.title, payload=payload))
    await db.commit()
    return {"token": token, "path": f"/s/{token}"}


@router.get("/share/{token}")
async def get_share(token: str, db: AsyncSession = Depends(get_session)):
    row = (await db.execute(select(SharedScenario).where(SharedScenario.token == token))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "This link does not exist or was removed")
    return {**row.payload, "created_at": row.created_at}


@router.delete("/share/{token}", status_code=204)
async def delete_share(token: str, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_session)):
    row = (await db.execute(select(SharedScenario).where(
        SharedScenario.token == token, SharedScenario.user_id == user.id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Link not found")
    await db.delete(row)
    await db.commit()


# ---------------- imports ----------------
@router.post("/twin/import-holdings", status_code=201)
async def import_holdings(req: ImportRequest, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_session)):
    """Called only after the user has reviewed the parsed rows. Creates a new twin snapshot."""
    rows = []
    for h in req.holdings:
        value = round(h.units * h.nav, 2) if h.units is not None and h.nav is not None else h.cost
        if value is None:
            raise HTTPException(422, f"Holding {h.isin} has no value: enter units and NAV, or a cost.")
        rows.append((h, value))
    t = await latest_twin_row(user, db)
    incoming = {(h.isin, h.folio or "") for h, _ in rows}
    assets = []
    if t:
        for a in t.assets:
            meta = a.meta or {}
            if (meta.get("isin"), meta.get("folio") or "") in incoming:
                continue  # re-importing the same folio replaces it
            assets.append((a.kind, a.name, a.value, meta))
    for h, v in rows:
        assets.append(("equity_mf", h.name or h.isin, v,
                       {"isin": h.isin, "folio": h.folio or "", "units": h.units, "nav": h.nav,
                        "cost": h.cost, "source": "cas"}))
    liabs = list(t.liabilities) if t else []
    total_a = round(sum(a[2] for a in assets), 2)
    total_l = round(sum(l.principal for l in liabs), 2)
    new = FinancialTwin(
        user_id=user.id, version_id=(t.version_id if t else 0) + 1,
        monthly_income=t.monthly_income if t else 0.0, monthly_expenses=t.monthly_expenses if t else 0.0,
        monthly_sip=t.monthly_sip if t else 0.0, annual_return=t.annual_return if t else 0.12,
        net_worth=round(total_a - total_l, 2), total_assets=total_a, total_liabilities=total_l)
    db.add(new)
    await db.flush()
    db.add_all(Asset(twin_id=new.id, kind=k, name=n, value=v, meta=m) for k, n, v, m in assets)
    db.add_all(Liability(twin_id=new.id, name=l.name, principal=l.principal, interest_rate=l.interest_rate,
                         remaining_months=l.remaining_months, monthly_emi=l.monthly_emi) for l in liabs)
    await db.commit()
    return {"version_id": new.version_id, "net_worth": new.net_worth, "imported": len(rows)}


@router.post("/parse/bank-file")
async def parse_bank_file(file: UploadFile = File(...), password: Optional[str] = Form(None),
                          user: User = Depends(get_current_user)):
    data = await read_upload(file)
    try:
        if (file.filename or "").lower().endswith(".pdf") or data[:4] == b"%PDF":
            txns = parse_statement(await asyncio.to_thread(extract_text, data, password))
        else:
            txns = parse_csv(data.decode("utf-8-sig", errors="replace"))
    except Exception:
        raise HTTPException(400, "Could not read this file (wrong password or unsupported format)")
    return {"transactions": txns, "count": len(txns)}
