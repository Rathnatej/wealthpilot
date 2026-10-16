"""Credit health coach.

Deterministic only: it never fetches a bureau score (that needs a licensed
integration) and never predicts exact score changes. The user supplies their
own score and account details; the engine computes utilisation, obligations,
pay-down amounts and a payoff plan, and turns them into prioritised actions.
"""
import asyncio
import logging
import os
import secrets
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import mailer
from auth import get_current_user
from database import get_session
from models import CreditSnapshot, User
from planners import fmt_inr

log = logging.getLogger("wealthpilot.credit")
router = APIRouter(tags=["credit"])

UTIL_GOOD = 0.30
UTIL_EXCELLENT = 0.10
DTI_GOOD = 0.35
DTI_WARN = 0.50
MIN_FLOOR = 200.0       # assumed minimum payment floor when min due is not given
MIN_PCT = 0.05          # assumed minimum due: 5% of balance
MAX_MONTHS = 600

# Commonly used 300-900 bands. Lenders differ; shown as a guide only.
BANDS = [(300, 549, "Poor"), (550, 649, "Fair"), (650, 749, "Good"), (750, 900, "Excellent")]


class CardIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    limit: float = Field(gt=0, le=1e8)
    balance: float = Field(ge=0, le=1e8)
    apr: float = Field(default=42.0, ge=0, le=100, description="annual interest %")
    min_due: Optional[float] = Field(default=None, ge=0, le=1e8)
    due_day: Optional[int] = Field(default=None, ge=1, le=31, description="day of month the payment is due")


class LoanIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    emi: float = Field(ge=0, le=1e8)
    outstanding: float = Field(default=0, ge=0, le=1e9)


class CreditRequest(BaseModel):
    score: Optional[int] = Field(default=None, ge=300, le=900)
    monthly_income: float = Field(default=0, ge=0, le=1e8)
    cards: list[CardIn] = Field(default_factory=list, max_length=20)
    loans: list[LoanIn] = Field(default_factory=list, max_length=20)
    missed_payments_12m: int = Field(default=0, ge=0, le=12)
    has_settled_or_written_off: bool = False
    oldest_account_years: float = Field(default=0, ge=0, le=80)
    enquiries_6m: int = Field(default=0, ge=0, le=50)
    monthly_card_budget: float = Field(default=0, ge=0, le=1e8,
                                       description="what you can pay towards cards each month")


# ---------------- helpers ----------------
def score_band(score: Optional[int]) -> Optional[dict]:
    if score is None:
        return None
    for lo, hi, name in BANDS:
        if lo <= score <= hi:
            nxt = next(((b[0], b[2]) for b in BANDS if b[0] > hi), None)
            return {
                "name": name,
                "next_band": nxt[1] if nxt else None,
                "points_to_next_band": (nxt[0] - score) if nxt else 0,
            }
    return None


def _min_pay(card: CardIn, balance: float) -> float:
    if balance <= 0:
        return 0.0
    base = card.min_due if card.min_due is not None else max(MIN_FLOOR, MIN_PCT * balance)
    return min(balance, base)


def pay_to_reach(card: CardIn, target_util: float) -> float:
    """Amount to pay so this card's utilisation is at or below target."""
    return round(max(0.0, card.balance - target_util * card.limit), 2)


def limit_needed(card: CardIn, target_util: float) -> float:
    """Extra limit (at the same balance) that would reach the target."""
    return round(max(0.0, card.balance / target_util - card.limit), 2)


def simulate_payoff(cards: list[CardIn], budget: float,
                    strategy: Literal["avalanche", "snowball", "minimum"]) -> dict:
    """Month-by-month payoff with no new spending (an assumption we state)."""
    bal = [c.balance for c in cards]
    total_limit = sum(c.limit for c in cards)
    if not any(b > 0 for b in bal):
        return {"strategy": strategy, "months": 0, "total_interest": 0.0, "cleared": True,
                "months_to_30pct": 0, "months_to_10pct": 0}

    start_mins = sum(_min_pay(c, b) for c, b in zip(cards, bal))
    eff_budget = start_mins if strategy == "minimum" else max(budget, start_mins)

    def order() -> list[int]:
        live = [i for i, b in enumerate(bal) if b > 0.005]
        if strategy == "snowball":
            return sorted(live, key=lambda i: bal[i])
        return sorted(live, key=lambda i: -cards[i].apr)  # avalanche (and extras for minimum)

    interest_total = 0.0
    m30 = m10 = None
    months = 0
    while months < MAX_MONTHS and any(b > 0.005 for b in bal):
        months += 1
        for i, c in enumerate(cards):
            if bal[i] > 0:
                add = bal[i] * c.apr / 1200
                bal[i] += add
                interest_total += add
        spent = 0.0
        for i, c in enumerate(cards):
            p = min(_min_pay(c, bal[i]), bal[i])
            bal[i] -= p
            spent += p
        extra = max(0.0, eff_budget - spent) if strategy != "minimum" else 0.0
        for i in order():
            if extra <= 0:
                break
            p = min(extra, bal[i])
            bal[i] -= p
            extra -= p
        util = sum(bal) / total_limit
        if m30 is None and util <= UTIL_GOOD:
            m30 = months
        if m10 is None and util <= UTIL_EXCELLENT:
            m10 = months
    cleared = not any(b > 0.005 for b in bal)
    return {
        "strategy": strategy,
        "months": months,
        "total_interest": round(interest_total, 2),
        "cleared": cleared,
        "months_to_30pct": m30,
        "months_to_10pct": m10,
    }


def _factor(key: str, label: str, impact: str, status: str, value: str, why: str) -> dict:
    return {"key": key, "label": label, "impact": impact, "status": status, "value": value, "why": why}


# ---------------- main analysis ----------------
def analyze(r: CreditRequest) -> dict:
    total_limit = sum(c.limit for c in r.cards)
    total_bal = sum(c.balance for c in r.cards)
    util = (total_bal / total_limit) if total_limit > 0 else None
    card_mins = sum(_min_pay(c, c.balance) for c in r.cards)
    loan_emis = sum(l.emi for l in r.loans)
    obligations = card_mins + loan_emis
    dti = (obligations / r.monthly_income) if r.monthly_income > 0 else None

    factors: list[dict] = []

    # Payment history
    if r.has_settled_or_written_off or r.missed_payments_12m >= 3:
        st = "bad"
    elif r.missed_payments_12m >= 1:
        st = "warn"
    else:
        st = "good"
    pv = f"{r.missed_payments_12m} late month(s) in the last 12" + (", settled/written-off account" if r.has_settled_or_written_off else "")
    factors.append(_factor(
        "payment_history", "Payment history", "Very high", st, pv,
        "On-time payment is the biggest driver. Late payments and settled accounts weigh on a report for years.",
    ))

    # Utilisation
    if util is not None:
        st = "good" if util <= UTIL_GOOD else "warn" if util <= 0.5 else "bad"
        factors.append(_factor(
            "utilization", "Credit-card utilisation", "High", st, f"{util * 100:.0f}% of your limits",
            "Lenders like to see you using well under 30% of your total card limit.",
        ))

    # Age
    if r.oldest_account_years > 0 or r.cards or r.loans:
        a = r.oldest_account_years
        st = "good" if a >= 5 else "warn" if a >= 2 else "bad"
        factors.append(_factor(
            "age", "Credit history length", "Medium", st, f"{a:g} years (oldest account)",
            "Longer history shows a track record. Closing your oldest card shortens it.",
        ))

    # Enquiries
    st = "good" if r.enquiries_6m <= 1 else "warn" if r.enquiries_6m <= 3 else "bad"
    factors.append(_factor(
        "enquiries", "New credit applications", "Low to medium", st, f"{r.enquiries_6m} in the last 6 months",
        "Each application triggers a hard enquiry. Many in a short time can look like credit hunger.",
    ))

    # DTI
    if dti is not None:
        st = "good" if dti <= DTI_GOOD else "warn" if dti <= DTI_WARN else "bad"
        factors.append(_factor(
            "dti", "Monthly obligations vs income", "Affects loan approval", st,
            f"{dti * 100:.0f}% of income ({fmt_inr(obligations)}/mo)",
            "Lenders compare your EMIs and card dues to income when deciding how much to lend.",
        ))

    # ---------- actions ----------
    actions: list[dict] = []

    def add(when: str, title: str, detail: str, priority: int) -> None:
        actions.append({"when": when, "title": title, "detail": detail, "priority": priority})

    if r.missed_payments_12m > 0:
        add("This week", "Clear anything overdue and turn on auto-pay",
            "Pay any overdue amount first. Then set auto-debit for at least the minimum due on every card and loan, "
            "so a missed date can never happen again.", 1)
    else:
        add("This week", "Keep your clean record safe",
            "Set auto-debit for at least the minimum due on every card and loan so one forgotten date cannot hurt you.", 6)

    if r.has_settled_or_written_off:
        add("This month", "Get settled accounts shown correctly",
            "Ask the lender for a no-dues / closure letter and check the bureau shows the right status. "
            "Time and on-time payments are what rebuild trust.", 2)

    high_cards = [c for c in r.cards if c.balance > UTIL_GOOD * c.limit]
    if util is not None and util > UTIL_GOOD:
        need = max(0.0, total_bal - UTIL_GOOD * total_limit)
        parts = [f"{c.name}: pay {fmt_inr(pay_to_reach(c, UTIL_GOOD))}" for c in high_cards[:5]]
        add("This month", f"Bring utilisation under 30% (pay about {fmt_inr(need)} in total)",
            "Cards over 30% — " + "; ".join(parts) + ". Pay before the statement date, because issuers usually report the "
            "statement balance.", 2)
        lim = [f"{c.name}: +{fmt_inr(limit_needed(c, UTIL_GOOD))}" for c in high_cards[:5] if limit_needed(c, UTIL_GOOD) > 0]
        if lim:
            add("This month", "Or ask for a higher limit on the same balance",
                "A limit increase lowers utilisation without paying anything down — " + "; ".join(lim)
                + ". Only do this if you will not spend the extra room.", 5)
    elif util is not None and util > UTIL_EXCELLENT:
        add("This month", "Optional: go below 10% utilisation",
            f"You are under 30%. Paying down about {fmt_inr(max(0.0, total_bal - UTIL_EXCELLENT * total_limit))} more would "
            "take you under 10%.", 7)

    if r.enquiries_6m >= 3:
        add("Next 3 months", "Pause new credit applications",
            "Avoid applying for new cards or loans for a few months. Use eligibility checkers that do a soft check "
            "where available.", 3)
    elif r.enquiries_6m == 2:
        add("Next 3 months", "Space out new applications", "Apply only when you really need credit.", 6)

    if r.oldest_account_years and r.oldest_account_years < 5 or not r.oldest_account_years:
        add("Next 3 months", "Keep your oldest account open and active",
            "Do not close your oldest card. A small regular purchase paid in full keeps it active at almost no cost.", 5)

    if dti is not None and dti > DTI_GOOD:
        add("Next 3 months", "Reduce monthly obligations",
            f"Your EMIs and card dues take {dti * 100:.0f}% of income. Clearing the highest-interest card first "
            "frees cash fastest (see the payoff plan).", 3)

    add("Anytime", "Check your credit report for errors",
        "You are entitled to a free full report from each bureau at least once a year. Dispute any account you do "
        "not recognise or any wrong late-payment entry.", 4)

    actions.sort(key=lambda a: a["priority"])

    # ---------- payoff plan ----------
    payoff = None
    if total_bal > 0:
        budget = r.monthly_card_budget if r.monthly_card_budget > 0 else card_mins
        payoff = {
            "monthly_budget": round(max(budget, card_mins), 2),
            "avalanche": simulate_payoff(r.cards, budget, "avalanche"),
            "snowball": simulate_payoff(r.cards, budget, "snowball"),
            "minimum_only": simulate_payoff(r.cards, budget, "minimum"),
            "assumptions": [
                "No new spending on these cards while paying down.",
                f"Minimum due is the amount you entered, otherwise {int(MIN_PCT * 100)}% of the balance (at least {fmt_inr(MIN_FLOOR)}).",
                "Interest is charged monthly at APR ÷ 12.",
            ],
        }
        a, m = payoff["avalanche"], payoff["minimum_only"]
        payoff["interest_saved_vs_minimum"] = round(max(0.0, m["total_interest"] - a["total_interest"]), 2)

    cards_out = [{
        "name": c.name,
        "utilization_pct": round(c.balance / c.limit * 100, 1),
        "pay_to_30pct": pay_to_reach(c, UTIL_GOOD),
        "pay_to_10pct": pay_to_reach(c, UTIL_EXCELLENT),
        "limit_needed_for_30pct": limit_needed(c, UTIL_GOOD),
    } for c in r.cards]

    counts = {s: sum(1 for f in factors if f["status"] == s) for s in ("good", "warn", "bad")}
    return {
        "score": r.score,
        "band": score_band(r.score),
        "utilization_pct": None if util is None else round(util * 100, 1),
        "dti_pct": None if dti is None else round(dti * 100, 1),
        "monthly_obligations": round(obligations, 2),
        "factors": factors,
        "factor_counts": counts,
        "cards": cards_out,
        "actions": actions,
        "payoff": payoff,
        "disclaimer": "Educational guidance, not a prediction of your score or financial advice. "
                      "Bureau scoring models are private and differ between bureaus.",
    }


@router.post("/credit/analyze")
def credit_analyze(body: CreditRequest) -> dict:
    return analyze(body)


# ---------------- "what if I pay ₹X" ----------------
class WhatIfRequest(BaseModel):
    request: CreditRequest
    extra_payment: float = Field(ge=0, le=1e9)


def what_if(r: CreditRequest, extra: float) -> dict:
    """Apply a one-off payment to the highest-APR cards first, then recompute everything."""
    cards = [c.model_copy() for c in r.cards]
    order = sorted(range(len(cards)), key=lambda i: -cards[i].apr)
    left = extra
    alloc = []
    for i in order:
        if left <= 0:
            break
        pay = min(left, cards[i].balance)
        if pay > 0:
            cards[i].balance = round(cards[i].balance - pay, 2)
            left -= pay
            alloc.append({"card": cards[i].name, "paid": round(pay, 2)})
    applied = round(extra - left, 2)

    limit = sum(c.limit for c in cards)
    before_bal = sum(c.balance for c in r.cards)
    after_bal = sum(c.balance for c in cards)
    budget = r.monthly_card_budget if r.monthly_card_budget > 0 else sum(_min_pay(c, c.balance) for c in r.cards)

    def util(b: float) -> Optional[float]:
        return round(b / limit * 100, 1) if limit > 0 else None

    before_run = simulate_payoff(r.cards, budget, "avalanche") if before_bal > 0 else None
    after_run = simulate_payoff(cards, budget, "avalanche") if after_bal > 0 else None
    u_after = util(after_bal)
    return {
        "extra_payment": round(extra, 2),
        "applied": applied,
        "unused": round(left, 2),
        "allocation": alloc,
        "utilization_before_pct": util(before_bal),
        "utilization_after_pct": u_after,
        "under_30_after": u_after is not None and u_after <= UTIL_GOOD * 100,
        "under_10_after": u_after is not None and u_after <= UTIL_EXCELLENT * 100,
        "months_before": before_run["months"] if before_run else 0,
        "months_after": after_run["months"] if after_run else 0,
        "interest_before": before_run["total_interest"] if before_run else 0.0,
        "interest_after": after_run["total_interest"] if after_run else 0.0,
        "interest_saved": round(max(0.0, (before_run["total_interest"] if before_run else 0.0)
                                    - (after_run["total_interest"] if after_run else 0.0)), 2),
        "note": "Assumes the payment is made before your statement date and no new spending.",
    }


@router.post("/credit/what-if")
def credit_what_if(body: WhatIfRequest) -> dict:
    return what_if(body.request, body.extra_payment)


# ---------------- saved snapshots ----------------
MAX_SNAPSHOTS = 120


def _snap_out(s: CreditSnapshot) -> dict:
    return {
        "id": s.id, "created_at": s.created_at.isoformat() if s.created_at else None,
        "score": s.score, "utilization_pct": s.utilization_pct, "dti_pct": s.dti_pct,
        "total_balance": s.total_balance, "total_limit": s.total_limit,
    }


@router.post("/credit/snapshots", status_code=201)
async def save_snapshot(body: CreditRequest, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_session)) -> dict:
    existing = (await db.execute(select(CreditSnapshot.id).where(CreditSnapshot.user_id == user.id))).scalars().all()
    if len(existing) >= MAX_SNAPSHOTS:
        raise HTTPException(429, "Snapshot limit reached. Delete an old one first.")
    a = analyze(body)
    snap = CreditSnapshot(
        user_id=user.id, score=body.score, utilization_pct=a["utilization_pct"], dti_pct=a["dti_pct"],
        total_balance=sum(c.balance for c in body.cards), total_limit=sum(c.limit for c in body.cards),
        inputs=body.model_dump(),
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return _snap_out(snap)


@router.get("/credit/snapshots")
async def list_snapshots(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)) -> list[dict]:
    rows = (await db.execute(select(CreditSnapshot).where(CreditSnapshot.user_id == user.id)
                             .order_by(CreditSnapshot.id))).scalars().all()
    return [_snap_out(s) for s in rows]


@router.get("/credit/snapshots/latest")
async def latest_snapshot(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)):
    s = await _latest(user.id, db)
    return None if s is None else {**_snap_out(s), "inputs": s.inputs}


@router.delete("/credit/snapshots/{snap_id}", status_code=204)
async def delete_snapshot(snap_id: int, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_session)) -> None:
    s = await db.get(CreditSnapshot, snap_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Snapshot not found")
    await db.delete(s)
    await db.commit()


async def _latest(user_id: int, db: AsyncSession) -> Optional[CreditSnapshot]:
    return (await db.execute(select(CreditSnapshot).where(CreditSnapshot.user_id == user_id)
                             .order_by(CreditSnapshot.id.desc()).limit(1))).scalars().first()


# ---------------- payment-due reminders ----------------
REMIND_WINDOW_DAYS = 3


def next_due_date(due_day: int, today: date) -> date:
    import calendar

    def clamp(y: int, m: int) -> date:
        return date(y, m, min(due_day, calendar.monthrange(y, m)[1]))

    this = clamp(today.year, today.month)
    if this >= today:
        return this
    y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return clamp(y, m)


def due_reminders(cards: list[dict], today: date, window: int = REMIND_WINDOW_DAYS) -> list[dict]:
    out = []
    for c in cards:
        dd, bal = c.get("due_day"), float(c.get("balance") or 0)
        if not dd or bal <= 0:
            continue
        due = next_due_date(int(dd), today)
        days = (due - today).days
        if 0 <= days <= window:
            card = CardIn(**{k: v for k, v in c.items() if k in CardIn.model_fields})
            out.append({"name": card.name, "due_date": due.isoformat(), "days": days,
                        "minimum_due": round(_min_pay(card, card.balance), 2), "balance": card.balance})
    return sorted(out, key=lambda x: x["days"])


def _reminder_body(items: list[dict]) -> str:
    lines = []
    for it in items:
        when = "today" if it["days"] == 0 else f"in {it['days']} day(s)"
        lines.append(f"- {it['name']}: due {when} ({it['due_date']}). Minimum about {fmt_inr(it['minimum_due'])}, "
                     f"balance {fmt_inr(it['balance'])}.")
    return ("Hi,\n\nCredit card payments coming up:\n\n" + "\n".join(lines)
            + "\n\nPaying at least the minimum on time protects your score; paying in full avoids interest. "
              "Amounts are from your last saved snapshot and may be out of date.\n"
              "This is an educational reminder, not financial advice. Turn these emails off on your dashboard.\n")


@router.post("/credit/reminders/send")
async def send_reminders(x_cron_secret: Optional[str] = Header(None), db: AsyncSession = Depends(get_session)):
    """Scheduler endpoint (same secret as the digest). Emails opted-in users with a card due soon."""
    secret = os.getenv("CRON_SECRET")
    if not secret:
        raise HTTPException(503, "Reminders are not enabled")
    if not x_cron_secret or not secrets.compare_digest(x_cron_secret.encode(), secret.encode()):
        raise HTTPException(401, "Invalid secret")
    if not mailer.is_configured():
        raise HTTPException(503, "SMTP is not configured")
    users = (await db.execute(select(User).where(User.email_alerts.is_(True)))).scalars().all()
    today = date.today()
    sent = failed = 0
    for u in users:
        snap = await _latest(u.id, db)
        if snap is None:
            continue
        items = due_reminders((snap.inputs or {}).get("cards", []), today)
        if not items:
            continue
        try:
            await asyncio.to_thread(mailer.send_email, u.email, "Card payment due soon", _reminder_body(items))
            sent += 1
        except Exception:
            log.exception("credit reminder failed")
            failed += 1
    return {"opted_in": len(users), "sent": sent, "failed": failed}
