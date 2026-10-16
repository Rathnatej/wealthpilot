from datetime import datetime, date
from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    risk_tolerance: Mapped[str] = mapped_column(String(20), default="moderate")
    twins: Mapped[list["FinancialTwin"]] = relationship(back_populates="user")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user")


class FinancialTwin(Base):
    __tablename__ = "financial_twins"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    version_id: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
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
    target_amount: Mapped[float] = mapped_column(Float)
    target_date: Mapped[date] = mapped_column(Date)
    inflation_rate: Mapped[float] = mapped_column(Float, default=0.06)
    linked_allocation: Mapped[dict] = mapped_column(JSON, default=dict)
    user: Mapped[User] = relationship(back_populates="goals")


class AuditLog(Base):
    """Append-only: only inserts are performed by the application."""
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # simulation / ai
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
