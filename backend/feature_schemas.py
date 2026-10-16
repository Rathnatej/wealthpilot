from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from schemas import ScenarioDelta, SimulationResponse, TwinInput


# ---------- AI intent / copilot ----------
class IntentParams(BaseModel):
    """Values the user *stated*. The backend (not the AI) turns these into numbers."""
    loan_amount: Optional[float] = None
    loan_rate_pct: Optional[float] = None
    loan_months: Optional[int] = None
    loan_emi: Optional[float] = None
    sip_change: Optional[float] = None
    lump_sum: Optional[float] = None


class LLMIntent(BaseModel):
    refused: bool = False
    message: str = ""
    params: Optional[IntentParams] = None


class CopilotRequest(BaseModel):
    query: str = Field(min_length=3, max_length=500)


class CopilotResponse(BaseModel):
    refused: bool = False
    message: str = ""
    scenario: Optional[ScenarioDelta] = None
    assumptions: list[str] = []
    simulation: Optional[SimulationResponse] = None
    explanation: str = ""
    source: Literal["ai", "template"] = "template"
    parsed_by: Literal["ai", "rules"] = "rules"


# ---------- Tutor / insights ----------
TutorTerm = Literal["xirr", "sip_step_up", "expense_ratio", "inflation", "emergency_fund", "compounding"]


class TutorRequest(BaseModel):
    term: TutorTerm


class Txn(BaseModel):
    date: str = Field(max_length=20)
    description: str = Field("", max_length=300)
    amount: float = Field(ge=0, le=1e11)
    type: Literal["debit", "credit"]
    category: str = Field("other", max_length=40)


class InsightsRequest(BaseModel):
    transactions: list[Txn] = Field(min_length=1, max_length=5000)


# ---------- Planners ----------
class StepUpReq(BaseModel):
    current_corpus: float = Field(0, ge=0, le=1e12)
    monthly_sip: float = Field(gt=0, le=1e9)
    step_up_pct: float = Field(10, ge=0, le=50)
    annual_return_pct: float = Field(12, ge=0, le=40)
    years: int = Field(10, ge=1, le=50)


class RetirementReq(BaseModel):
    current_age: int = Field(ge=18, le=80)
    retirement_age: int = Field(ge=19, le=90)
    life_expectancy: int = Field(ge=20, le=110)
    monthly_expenses: float = Field(gt=0, le=1e8)
    inflation_pct: float = Field(6, ge=0, le=20)
    pre_return_pct: float = Field(11, ge=0, le=30)
    post_return_pct: float = Field(7, ge=0, le=20)
    current_corpus: float = Field(0, ge=0, le=1e12)
    monthly_sip: float = Field(0, ge=0, le=1e9)
    step_up_pct: float = Field(0, ge=0, le=30)

    @model_validator(mode="after")
    def _ages(self):
        if not self.current_age < self.retirement_age < self.life_expectancy:
            raise ValueError("Ages must satisfy: current < retirement < life expectancy")
        return self


class LoanVsInvestReq(BaseModel):
    principal: float = Field(gt=0, le=1e10)
    annual_rate_pct: float = Field(ge=0, le=40)
    remaining_months: int = Field(ge=1, le=600)
    emi: Optional[float] = Field(None, gt=0, le=1e9)
    lump_sum: float = Field(0, ge=0, le=1e11)
    extra_monthly: float = Field(0, ge=0, le=1e9)
    invest_return_pct: float = Field(12, ge=0, le=40)

    @model_validator(mode="after")
    def _something_to_compare(self):
        if self.lump_sum <= 0 and self.extra_monthly <= 0:
            raise ValueError("Enter a lump sum or an extra monthly amount to compare")
        return self


# ---------- Sharing, import, prefs ----------
class ShareRequest(BaseModel):
    title: str = Field("My scenario", min_length=1, max_length=80)
    twin: TwinInput
    scenarios: list[ScenarioDelta] = Field(default_factory=list, max_length=3)


class HoldingIn(BaseModel):
    isin: str = Field(pattern=r"^INF[A-Z0-9]{9}$")
    folio: Optional[str] = Field(None, max_length=60)
    name: Optional[str] = Field(None, max_length=200)
    units: Optional[float] = Field(None, ge=0, le=1e9)
    nav: Optional[float] = Field(None, ge=0, le=1e7)
    cost: Optional[float] = Field(None, ge=0, le=1e12)


class ImportRequest(BaseModel):
    holdings: list[HoldingIn] = Field(min_length=1, max_length=200)


class PrefsIn(BaseModel):
    email_alerts: bool


class PrefsOut(PrefsIn):
    email_configured: bool
