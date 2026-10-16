"""Per-user data: financial twin snapshots and goals. Every query is scoped to the caller."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import engine
from auth import get_current_user
from database import get_session
from models import Asset, FinancialTwin, Goal, Liability, User
from schemas import (
    AssetIn, GoalIn, GoalOut, LiabilityIn, TwinIn, TwinOut, TwinSummary,
)

router = APIRouter(tags=["user"])


# ---------------- Financial twin ----------------
def _twin_out(t: FinancialTwin, assets: list[AssetIn], liabs: list[LiabilityIn]) -> TwinOut:
    return TwinOut(
        version_id=t.version_id, created_at=t.created_at,
        monthly_income=t.monthly_income, monthly_expenses=t.monthly_expenses,
        monthly_sip=t.monthly_sip, annual_return=t.annual_return,
        assets=assets, liabilities=liabs, net_worth=t.net_worth,
        total_assets=t.total_assets, total_liabilities=t.total_liabilities)


@router.post("/twin", response_model=TwinOut, status_code=201)
async def save_twin(body: TwinIn, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_session)):
    """Each save creates a new immutable snapshot with the next version number."""
    last = (await db.execute(
        select(func.max(FinancialTwin.version_id)).where(FinancialTwin.user_id == user.id)
    )).scalar() or 0
    total_assets = round(sum(a.value for a in body.assets), 2)
    total_liabs = round(sum(l.principal for l in body.liabilities), 2)
    twin = FinancialTwin(
        user_id=user.id, version_id=last + 1,
        monthly_income=body.monthly_income, monthly_expenses=body.monthly_expenses,
        monthly_sip=body.monthly_sip, annual_return=body.annual_return,
        net_worth=round(total_assets - total_liabs, 2),
        total_assets=total_assets, total_liabilities=total_liabs)
    db.add(twin)
    await db.flush()
    db.add_all(Asset(twin_id=twin.id, kind=a.kind, name=a.name, value=a.value, meta={})
               for a in body.assets)
    db.add_all(Liability(twin_id=twin.id, name=l.name, principal=l.principal,
                         interest_rate=l.interest_rate, remaining_months=l.remaining_months,
                         monthly_emi=l.monthly_emi) for l in body.liabilities)
    await db.commit()
    await db.refresh(twin)
    return _twin_out(twin, body.assets, body.liabilities)


@router.get("/twin/latest", response_model=Optional[TwinOut])
async def latest_twin(user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_session)):
    twin = (await db.execute(
        select(FinancialTwin).where(FinancialTwin.user_id == user.id)
        .order_by(FinancialTwin.version_id.desc()).limit(1)
        .options(selectinload(FinancialTwin.assets), selectinload(FinancialTwin.liabilities))
    )).scalar_one_or_none()
    if twin is None:
        return None
    return _twin_out(
        twin,
        [AssetIn(kind=a.kind, name=a.name, value=a.value) for a in twin.assets],
        [LiabilityIn(name=l.name, principal=l.principal, interest_rate=l.interest_rate,
                     remaining_months=l.remaining_months, monthly_emi=l.monthly_emi)
         for l in twin.liabilities])


@router.get("/twin/history", response_model=list[TwinSummary])
async def twin_history(user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(
        select(FinancialTwin).where(FinancialTwin.user_id == user.id)
        .order_by(FinancialTwin.version_id.asc()).limit(500))).scalars().all()
    return [TwinSummary(version_id=r.version_id, created_at=r.created_at, net_worth=r.net_worth,
                        total_assets=r.total_assets, total_liabilities=r.total_liabilities)
            for r in rows]


# ---------------- Goals ----------------
def _goal_out(g: Goal) -> GoalOut:
    status = engine.goal_status(
        g.target_amount, g.inflation_rate, g.current_saved or 0.0,
        g.monthly_contribution or 0.0,
        g.expected_return if g.expected_return is not None else 0.10, g.target_date)
    return GoalOut(
        id=g.id, name=g.name, target_amount=g.target_amount, target_date=g.target_date,
        inflation_rate=g.inflation_rate, current_saved=g.current_saved or 0.0,
        monthly_contribution=g.monthly_contribution or 0.0,
        expected_return=g.expected_return if g.expected_return is not None else 0.10, **status)


async def _owned_goal(goal_id: int, user: User, db: AsyncSession) -> Goal:
    goal = (await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id))).scalar_one_or_none()
    if goal is None:
        raise HTTPException(404, "Goal not found")
    return goal


@router.get("/goals", response_model=list[GoalOut])
async def list_goals(user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_session)):
    rows = (await db.execute(
        select(Goal).where(Goal.user_id == user.id).order_by(Goal.target_date))).scalars().all()
    return [_goal_out(g) for g in rows]


@router.post("/goals", response_model=GoalOut, status_code=201)
async def create_goal(body: GoalIn, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_session)):
    goal = Goal(user_id=user.id, linked_allocation={}, **body.model_dump())
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _goal_out(goal)


@router.put("/goals/{goal_id}", response_model=GoalOut)
async def update_goal(goal_id: int, body: GoalIn, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_session)):
    goal = await _owned_goal(goal_id, user, db)
    for k, v in body.model_dump().items():
        setattr(goal, k, v)
    await db.commit()
    await db.refresh(goal)
    return _goal_out(goal)


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_session)):
    goal = await _owned_goal(goal_id, user, db)
    await db.delete(goal)
    await db.commit()
    return Response(status_code=204)
