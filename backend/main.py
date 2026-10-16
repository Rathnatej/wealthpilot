import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

load_dotenv()

import ai_service, auth, engine, user_routes  # noqa: E402
from database import get_session, init_db  # noqa: E402
from models import AuditLog, User  # noqa: E402
from parsers.cas_parser import parse_cas  # noqa: E402
from parsers.bank_statement import parse_statement  # noqa: E402
from schemas import (  # noqa: E402
    ExplainRequest, ExplainResult, GoalInput, GoalResult, IntentResponse,
    SimulationRequest, SimulationResponse, XirrRequest,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="WealthPilot API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(user_routes.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/simulate", response_model=SimulationResponse)
async def simulate(req: SimulationRequest, db: AsyncSession = Depends(get_session)):
    baseline, results = engine.simulate(req.twin, req.scenarios)
    db.add(AuditLog(kind="simulation", payload={
        "request": req.model_dump(mode="json"),
        "final": [baseline.final_corpus] + [r.final_corpus for r in results]}))
    await db.commit()
    return SimulationResponse(baseline=baseline, scenarios=results)


@app.post("/goals/future-value", response_model=GoalResult)
async def goal_fv(g: GoalInput):
    return GoalResult(name=g.name, future_value=engine.future_value(g.present_value, g.inflation_rate, g.years))


@app.post("/xirr")
async def xirr(req: XirrRequest):
    try:
        return {"xirr": engine.xirr(req.dates, req.cashflows)}
    except ValueError as e:
        raise HTTPException(422, str(e))


# AI endpoints require login so the Gemini quota can't be abused anonymously.
@app.post("/ai/intent", response_model=IntentResponse)
async def intent(req: ExplainRequest, user: User = Depends(auth.get_current_user),
                 db: AsyncSession = Depends(get_session)):
    try:
        result = ai_service.parse_intent(req.query)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    db.add(AuditLog(kind="ai", payload={"user_id": user.id, "query": req.query,
                                        "result": result.model_dump()}))
    await db.commit()
    return result


@app.post("/ai/explain", response_model=ExplainResult)
async def explain(req: ExplainRequest, user: User = Depends(auth.get_current_user)):
    try:
        return ExplainResult(explanation=ai_service.explain(req.query))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@app.post("/parse/cas")
async def cas(file: UploadFile = File(...), password: str | None = Form(None),
              user: User = Depends(auth.get_current_user)):
    try:
        holdings = parse_cas(await file.read(), password)
    except Exception as e:
        raise HTTPException(400, f"Could not read PDF: {e}")
    return {"holdings": holdings, "review_required": [h for h in holdings if h["needs_review"]]}


@app.post("/parse/bank")
async def bank(text: str = Form(...), user: User = Depends(auth.get_current_user)):
    return {"transactions": parse_statement(text)}
