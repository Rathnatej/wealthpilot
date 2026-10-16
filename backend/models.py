from datetime import datetime, date
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    risk_tolerance: Mapped[str] = mapped_column(String(20), default="moderate")
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    google_sub: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email_alerts: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    twins: Mapped[list["FinancialTwin"]] = relationship(back_populates="user")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user")


class FinancialTwin(Base):
    """One immutable snapshot per save; version_id increases per user."""
    __tablename__ = "financial_twins"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    version_id: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    monthly_income: Mapped[float] = mapped_column(Float, default=0.0)
    monthly_expenses: Mapped[float] = mapped_column(Float, default=0.0)
    monthly_sip: Mapped[float] = mapped_column(Float, default=0.0)
    annual_return: Mapped[float] = mapped_column(Float, default=0.12)
    net_worth: Mapped[float] = mapped_column(Float, default=0.0)
    total_assets: Mapped[float] = mapped_column(Float, default=0.0)
    total_liabilities: Mapped[float] = mapped_column(Float, default=0.0)
    user: Mapped[User] = relationship(back_populates="twins")
    assets: Mapped[list["Asset"]] = relationship(back_populates="twin")
    liabilities: Mapped[list["Liability"]] = relationship(back_populates="twin")


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    twin_id: Mapped[int] = mapped_column(ForeignKey("financial_twins.id"))
    kind: Mapped[str] = mapped_column(String(30))  # cash/epf/ppf/equity_mf/gold/real_estate
    name: Mapped[str] = mapped_column(String(200))
    value: Mapped[float] = mapped_column(Float)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)  # isin, folio, units...
    twin: Mapped[FinancialTwin] = relationship(back_populates="assets")


class Liability(Base):
    __tablename__ = "liabilities"
    id: Mapped[int] = mapped_column(primary_key=True)
    twin_id: Mapped[int] = mapped_column(ForeignKey("financial_twins.id"))
    name: Mapped[str] = mapped_column(String(200))
    principal: Mapped[float] = mapped_column(Float)
    interest_rate: Mapped[float] = mapped_column(Float)
    remaining_months: Mapped[int] = mapped_column(Integer)
    monthly_emi: Mapped[float] = mapped_column(Float)
    twin: Mapped[FinancialTwin] = relationship(back_populates="liabilities")


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    target_amount: Mapped[float] = mapped_column(Float)  # in today's rupees
    target_date: Mapped[date] = mapped_column(Date)
    inflation_rate: Mapped[float] = mapped_column(Float, default=0.06)
    current_saved: Mapped[float] = mapped_column(Float, default=0.0)
    monthly_contribution: Mapped[float] = mapped_column(Float, default=0.0)
    expected_return: Mapped[float] = mapped_column(Float, default=0.10)
    linked_allocation: Mapped[dict] = mapped_column(JSON, default=dict)
    user: Mapped[User] = relationship(back_populates="goals")


class SharedScenario(Base):
    """A frozen, publicly viewable scenario result. Holds no personal data beyond what the owner chose to share."""
    __tablename__ = "shared_scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CreditSnapshot(Base):
    """One saved run of the credit coach. `inputs` holds what the user entered (cards, loans, due days)."""
    __tablename__ = "credit_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    utilization_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dti_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_balance: Mapped[float] = mapped_column(Float, default=0.0)
    total_limit: Mapped[float] = mapped_column(Float, default=0.0)
    inputs: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class VoiceProfile(Base):
    """Per-user voice assistant settings and consent (one row per user)."""
    __tablename__ = "voice_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    consented_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    save_history: Mapped[bool] = mapped_column(Boolean, default=False)
    voice: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)


class VoiceSession(Base):
    """One voice conversation. Transcript/summary are Fernet-encrypted; no audio is stored.
    Analytics fields (language, duration, end_reason, error_code) contain no content."""
    __tablename__ = "voice_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    voice: Mapped[str] = mapped_column(String(40), default="")
    language: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    end_reason: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    reconnects: Mapped[int] = mapped_column(Integer, default=0)
    transcript_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AuditLog(Base):
    """Append-only: only inserts are performed by the application."""
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # simulation / ai
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
