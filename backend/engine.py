"""Deterministic, stateless financial math. No AI involvement."""
from datetime import date

from schemas import (
    ScenarioDelta, SeriesPoint, SimulationResult, TwinInput,
)


def project(twin: TwinInput, name: str = "Baseline", sip_delta: float = 0.0,
            extra_emi: float = 0.0, extra_emi_months: int = 0,
            lump_sum: float = 0.0, return_delta: float = 0.0) -> SimulationResult:
    """Corpus_m = (Corpus_{m-1} + SIP) * (1 + rate/12). EMIs reduce investable SIP."""
    rate = (twin.annual_return + return_delta) / 12
    corpus = twin.current_corpus + lump_sum
    series = [SeriesPoint(month=0, corpus=round(corpus, 2))]
    for m in range(1, twin.years * 12 + 1):
        # existing EMI is assumed already netted out of the SIP; a new loan EMI reduces investable cash
        new_emi = extra_emi if m <= extra_emi_months else 0
        contribution = max(twin.monthly_sip + sip_delta - new_emi, 0)
        corpus = (corpus + contribution) * (1 + rate)
        series.append(SeriesPoint(month=m, corpus=round(corpus, 2)))
    return SimulationResult(name=name, series=series, final_corpus=series[-1].corpus)


def simulate(twin: TwinInput, scenarios: list[ScenarioDelta]):
    base = twin.model_copy(deep=True)  # stateless: never mutate the input
    baseline = project(base)
    results = [
        project(base.model_copy(deep=True), s.name, s.sip_delta, s.new_loan_emi,
                s.new_loan_months, s.lump_sum, s.return_delta)
        for s in scenarios
    ]
    return baseline, results


def future_value(present_value: float, inflation: float, years: float) -> float:
    return round(present_value * (1 + inflation) ** years, 2)


def xirr(dates: list[date], cashflows: list[float]) -> float:
    if len(dates) != len(cashflows) or len(dates) < 2:
        raise ValueError("Need at least two matching dates and cashflows")
    if not (any(c < 0 for c in cashflows) and any(c > 0 for c in cashflows)):
        raise ValueError("Cashflows need both positive and negative values")
    t0 = min(dates)
    years = [(d - t0).days / 365.0 for d in dates]

    def f(r): return sum(c / (1 + r) ** t for c, t in zip(cashflows, years))
    def df(r): return sum(-t * c / (1 + r) ** (t + 1) for c, t in zip(cashflows, years))

    r = 0.1
    for _ in range(100):
        d = df(r)
        if d == 0:
            break
        nr = r - f(r) / d
        if nr <= -0.999:
            nr = (r - 0.999) / 2
        if abs(nr - r) < 1e-10:
            return nr
        r = nr
    # fallback bracketed solver
    from scipy.optimize import brentq
    return brentq(f, -0.99, 10)


def goal_status(target_amount: float, inflation: float, current_saved: float,
                monthly: float, annual_return: float, target_date: date,
                today: date | None = None) -> dict:
    """Inflation-adjust a goal and project savings toward it (same recurrence as project())."""
    today = today or date.today()
    years = max((target_date - today).days, 0) / 365.25
    months = round(years * 12)
    inflated = future_value(target_amount, inflation, years)
    r = annual_return / 12
    g = (1 + r) ** months
    annuity = (1 + r) * (g - 1) / r if abs(r) > 1e-12 else float(months)
    projected = current_saved * g + monthly * annuity
    required = max((inflated - current_saved * g) / annuity, 0.0) if annuity > 0 else 0.0
    return {
        "years_left": round(years, 2),
        "inflated_target": inflated,
        "projected_value": round(projected, 2),
        "progress_pct": round(projected / inflated * 100, 1) if inflated > 0 else 0.0,
        "on_track": projected >= inflated,
        "required_monthly_contribution": round(required, 2),
        "shortfall": round(max(inflated - projected, 0.0), 2),
    }
