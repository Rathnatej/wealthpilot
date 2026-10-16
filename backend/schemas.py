from datetime import date
from typing import Optional
from pydantic import BaseModel, Field


class TwinInput(BaseModel):
    current_corpus: float = Field(0, ge=0)
    monthly_sip: float = Field(0, ge=0)
    annual_return: float = Field(0.12, ge=-0.5, le=1.0)
    monthly_emi: float = Field(0, ge=0)
    emi_months: int = Field(0, ge=0)
    years: int = Field(10, ge=1, le=50)


class ScenarioDelta(BaseModel):
    name: str = "Scenario"
    sip_delta: float = 0
    new_loan_emi: float = Field(0, ge=0)
    new_loan_months: int = Field(0, ge=0)
    lump_sum: float = 0
    return_delta: float = 0


class SimulationRequest(BaseModel):
    twin: TwinInput
    scenarios: list[ScenarioDelta] = []


class SeriesPoint(BaseModel):
    month: int
    corpus: float


class SimulationResult(BaseModel):
    name: str
    series: list[SeriesPoint]
    final_corpus: float


class SimulationResponse(BaseModel):
    baseline: SimulationResult
    scenarios: list[SimulationResult]


class GoalInput(BaseModel):
    name: str
    present_value: float = Field(gt=0)
    inflation_rate: float = Field(0.06, ge=0, le=0.5)
    years: float = Field(gt=0)


class GoalResult(BaseModel):
    name: str
    future_value: float


class XirrRequest(BaseModel):
    dates: list[date]
    cashflows: list[float]


class ExplainRequest(BaseModel):
    query: str


class IntentResponse(BaseModel):
    intent_level: int = 1
    scenario: Optional[ScenarioDelta] = None
    refused: bool = False
    message: str = ""


class ExplainResult(BaseModel):
    explanation: str
