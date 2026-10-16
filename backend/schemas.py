from datetime import date, datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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


# ---------- Auth ----------
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    name: str = Field("", max_length=120)

    @field_validator("password")
    @classmethod
    def _bcrypt_limit(cls, v: str) -> str:
        if len(v.encode()) > 72:
            raise ValueError("Password must be at most 72 bytes")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=10, max_length=4096)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Saved financial twin ----------
AssetKind = Literal["cash", "epf", "ppf", "equity_mf", "gold", "real_estate", "other"]


class AssetIn(BaseModel):
    kind: AssetKind
    name: str = Field(min_length=1, max_length=200)
    value: float = Field(ge=0, le=1e12)


class LiabilityIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    principal: float = Field(ge=0, le=1e12)
    interest_rate: float = Field(ge=0, le=1)  # annual, as a fraction
    remaining_months: int = Field(ge=0, le=600)
    monthly_emi: float = Field(ge=0, le=1e10)


class TwinIn(BaseModel):
    monthly_income: float = Field(0, ge=0, le=1e10)
    monthly_expenses: float = Field(0, ge=0, le=1e10)
    monthly_sip: float = Field(0, ge=0, le=1e10)
    annual_return: float = Field(0.12, ge=-0.5, le=1)
    assets: list[AssetIn] = Field(default_factory=list, max_length=100)
    liabilities: list[LiabilityIn] = Field(default_factory=list, max_length=100)


class TwinOut(TwinIn):
    version_id: int
    created_at: datetime
    net_worth: float
    total_assets: float
    total_liabilities: float


class TwinSummary(BaseModel):
    version_id: int
    created_at: datetime
    net_worth: float
    total_assets: float
    total_liabilities: float


# ---------- Goals ----------
class GoalBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    target_amount: float = Field(gt=0, le=1e12)  # in today's rupees
    target_date: date
    inflation_rate: float = Field(0.06, ge=0, le=0.5)
    current_saved: float = Field(0, ge=0, le=1e12)
    monthly_contribution: float = Field(0, ge=0, le=1e10)
    expected_return: float = Field(0.10, ge=-0.5, le=1)


class GoalIn(GoalBase):
    @field_validator("target_date")
    @classmethod
    def _future(cls, v: date) -> date:
        if v <= date.today():
            raise ValueError("Target date must be in the future")
        return v


class GoalOut(GoalBase):
    id: int
    years_left: float
    inflated_target: float
    projected_value: float
    progress_pct: float
    on_track: bool
    required_monthly_contribution: float
    shortfall: float
