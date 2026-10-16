"""Deterministic planners and calculators. No AI. The only randomness is a seeded Monte Carlo."""
import hashlib
import math

import numpy as np

from schemas import ScenarioDelta, TwinInput


def fmt_inr(v: float) -> str:
    a = abs(v)
    sign = "-" if v < 0 else ""
    if a >= 1e7:
        return f"{sign}₹{a / 1e7:.2f} Cr"
    if a >= 1e5:
        return f"{sign}₹{a / 1e5:.2f} L"
    return f"{sign}₹{round(a):,}"


def emi(principal: float, annual_rate: float, months: int) -> float:
    if months <= 0:
        return 0.0
    r = annual_rate / 12
    if abs(r) < 1e-12:
        return principal / months
    return principal * r * (1 + r) ** months / ((1 + r) ** months - 1)


def contributed(twin: TwinInput, delta: ScenarioDelta | None = None) -> float:
    """Total money put in over the horizon (mirrors engine.project's contribution rule)."""
    d = delta or ScenarioDelta()
    total = twin.current_corpus + d.lump_sum
    for m in range(1, twin.years * 12 + 1):
        new_emi = d.new_loan_emi if m <= d.new_loan_months else 0
        total += max(twin.monthly_sip + d.sip_delta - new_emi, 0)
    return round(total, 2)


# ---------------- Goal risk (seeded Monte Carlo) ----------------
def monte_carlo_goal(current_saved: float, monthly: float, annual_return: float,
                     volatility: float, months: int, target: float, paths: int = 5000) -> dict:
    months = max(int(months), 0)
    key = repr((round(current_saved, 2), round(monthly, 2), round(annual_return, 6),
                round(volatility, 6), months, round(target, 2), paths)).encode()
    rng = np.random.default_rng(int.from_bytes(hashlib.sha256(key).digest()[:8], "big"))
    m = annual_return / 12
    s = volatility / math.sqrt(12)
    mu_log = math.log1p(m) - 0.5 * s * s  # so that E[growth factor] = 1 + m
    corpus = np.full(paths, float(current_saved))

    def snap(month: int) -> dict:
        p10, p50, p90 = np.percentile(corpus, [10, 50, 90])
        return {"month": month, "p10": round(float(p10), 2), "p50": round(float(p50), 2),
                "p90": round(float(p90), 2)}

    fan = [snap(0)]
    for k in range(1, months + 1):
        z = rng.standard_normal(paths) if s > 0 else 0.0
        corpus = (corpus + monthly) * np.exp(mu_log + s * z)
        if k % 12 == 0 or k == months:
            fan.append(snap(k))
    final = fan[-1]
    return {
        "probability": round(float(np.mean(corpus >= target)), 4),
        "p10": final["p10"], "p50": final["p50"], "p90": final["p90"],
        "target": round(target, 2), "paths": paths, "volatility": volatility, "fan": fan,
    }


# ---------------- Step-up SIP ----------------
def stepup_projection(current: float, sip: float, step: float, annual_return: float, years: int) -> dict:
    r = annual_return / 12

    def run(step_rate: float):
        corpus, invested, s = current, current, sip
        out = [(0, round(corpus, 2), round(invested, 2))]
        for m in range(1, years * 12 + 1):
            corpus = (corpus + s) * (1 + r)
            invested += s
            if m % 12 == 0:
                out.append((m // 12, round(corpus, 2), round(invested, 2)))
                s *= 1 + step_rate
        return out

    flat, up = run(0.0), run(step)
    return {
        "series": [{"year": a[0], "flat": a[1], "step_up": b[1],
                    "invested_flat": a[2], "invested_step_up": b[2]} for a, b in zip(flat, up)],
        "final_flat": flat[-1][1], "final_step_up": up[-1][1],
        "invested_flat": flat[-1][2], "invested_step_up": up[-1][2],
        "extra_wealth": round(up[-1][1] - flat[-1][1], 2),
        "final_year_sip": round(sip * (1 + step) ** max(years - 1, 0), 2),
    }


# ---------------- Retirement ----------------
def _accumulate(current: float, sip: float, step: float, annual_return: float, years: int) -> float:
    r = annual_return / 12
    corpus, s = current, sip
    for m in range(1, years * 12 + 1):
        corpus = (corpus + s) * (1 + r)
        if m % 12 == 0:
            s *= 1 + step
    return corpus


def _required_sip(current: float, need: float, step: float, annual_return: float, years: int) -> float:
    if _accumulate(current, 0.0, step, annual_return, years) >= need:
        return 0.0
    lo, hi = 0.0, max(need / max(years * 12, 1), 1.0)
    for _ in range(60):
        if _accumulate(current, hi, step, annual_return, years) >= need:
            break
        hi *= 2
    for _ in range(60):
        mid = (lo + hi) / 2
        if _accumulate(current, mid, step, annual_return, years) >= need:
            hi = mid
        else:
            lo = mid
    return float(math.ceil(hi))  # round up so the quoted SIP always covers the need


def retirement_plan(current_age: int, retirement_age: int, life_expectancy: int,
                    monthly_expenses: float, inflation: float, pre_return: float,
                    post_return: float, current_corpus: float, monthly_sip: float,
                    step_up: float = 0.0) -> dict:
    years_to = retirement_age - current_age
    years_in = life_expectancy - retirement_age
    annual_at_ret = monthly_expenses * 12 * (1 + inflation) ** years_to
    need = sum(annual_at_ret * (1 + inflation) ** k / (1 + post_return) ** k for k in range(years_in))

    # accumulation phase (yearly snapshots)
    r = pre_return / 12
    corpus, s = current_corpus, monthly_sip
    series = [{"age": current_age, "corpus": round(corpus, 2), "phase": "saving"}]
    for m in range(1, years_to * 12 + 1):
        corpus = (corpus + s) * (1 + r)
        if m % 12 == 0:
            series.append({"age": current_age + m // 12, "corpus": round(corpus, 2), "phase": "saving"})
            s *= 1 + step_up
    projected = corpus

    # drawdown phase: withdraw at the start of each year, then grow
    depletion_age = None
    bal = projected
    for k in range(years_in):
        w = annual_at_ret * (1 + inflation) ** k
        if depletion_age is None and bal < w - 1.0:
            depletion_age = retirement_age + k
        bal = 0.0 if depletion_age is not None else (bal - w) * (1 + post_return)
        series.append({"age": retirement_age + k + 1, "corpus": round(max(bal, 0.0), 2), "phase": "retired"})

    return {
        "years_to_retirement": years_to, "retirement_years": years_in,
        "expenses_at_retirement_monthly": round(annual_at_ret / 12, 2),
        "corpus_needed": round(need, 2), "projected_corpus": round(projected, 2),
        "gap": round(max(need - projected, 0.0), 2),
        "on_track": projected >= need - 1.0,
        "required_monthly_sip": _required_sip(current_corpus, need, step_up, pre_return, years_to),
        "depletion_age": depletion_age,
        "fire_number_today": round(monthly_expenses * 12 * 25, 2),
        "series": series,
    }


# ---------------- Loan vs invest ----------------
def _loan_vs_invest_run(prepay: bool, principal: float, annual_rate: float, months: int, emi_amount: float,
                        lump_sum: float, extra_monthly: float, invest_return: float) -> dict:
    r_loan, r_inv = annual_rate / 12, invest_return / 12
    bal, interest, closed = float(principal), 0.0, None
    if prepay:
        applied = min(lump_sum, bal)
        bal -= applied
        inv = lump_sum - applied
        if bal <= 0.005:
            bal, closed = 0.0, 0
    else:
        inv = float(lump_sum)
    cash_out = emi_amount + extra_monthly
    for m in range(1, months + 1):
        pay = 0.0
        if bal > 0.005:
            i = bal * r_loan
            interest += i
            pay = min(cash_out if prepay else emi_amount, bal + i)
            bal = bal + i - pay
            if bal <= 0.005:
                bal = 0.0
                if closed is None:
                    closed = m
        inv = (inv + cash_out - pay) * (1 + r_inv)
    return {"final_net_worth": round(inv - bal, 2), "interest_paid": round(interest, 2),
            "loan_closed_month": closed, "investments": round(inv, 2), "loan_balance": round(bal, 2)}


def loan_vs_invest(principal: float, annual_rate: float, months: int, emi_amount: float | None,
                   lump_sum: float, extra_monthly: float, invest_return: float) -> dict:
    e = emi_amount if emi_amount else emi(principal, annual_rate, months)
    args = (principal, annual_rate, months, e, lump_sum, extra_monthly)
    prepay = _loan_vs_invest_run(True, *args, invest_return)
    invest = _loan_vs_invest_run(False, *args, invest_return)

    def diff(ri: float) -> float:
        return (_loan_vs_invest_run(True, *args, ri)["final_net_worth"]
                - _loan_vs_invest_run(False, *args, ri)["final_net_worth"])

    lo, hi = 0.0, 0.6
    breakeven = None
    if diff(lo) > 0 > diff(hi):
        for _ in range(50):
            mid = (lo + hi) / 2
            if diff(mid) > 0:
                lo = mid
            else:
                hi = mid
        breakeven = round((lo + hi) / 2, 4)
    a, b = prepay["final_net_worth"], invest["final_net_worth"]
    return {
        "emi": round(e, 2), "prepay": prepay, "invest": invest,
        "winner": "prepay" if a >= b else "invest", "difference": round(abs(a - b), 2),
        "interest_saved": round(invest["interest_paid"] - prepay["interest_paid"], 2),
        "breakeven_return": breakeven,
    }


# ---------------- Financial health ----------------
def health_score(income: float, expenses: float, emis: float, liquid: float,
                 goals_total: int, goals_on_track: int) -> dict:
    comps = []

    def add(key, label, points, max_pts, value, note):
        comps.append({"key": key, "label": label, "points": round(points, 1), "max": max_pts,
                      "value": value, "note": note})

    ef = liquid / expenses if expenses > 0 else None
    add("emergency", "Emergency fund", 30 * min(ef / 6, 1.0) if ef is not None else 0, 30,
        round(ef, 1) if ef is not None else None,
        "Months of expenses held in cash (a common benchmark is 6)." if ef is not None
        else "Add monthly expenses to measure this.")

    dti = emis / income if income > 0 else None
    if dti is None:
        pts = 0.0
    elif dti <= 0.2:
        pts = 25.0
    elif dti >= 0.5:
        pts = 0.0
    else:
        pts = 25 * (0.5 - dti) / 0.3
    add("dti", "Debt-to-income", pts, 25, round(dti * 100, 1) if dti is not None else None,
        "EMIs as a share of income; lower is healthier." if dti is not None else "Add income to measure this.")

    rate = (income - expenses - emis) / income if income > 0 else None
    add("savings", "Savings rate", 25 * min(max(rate, 0) / 0.2, 1.0) if rate is not None else 0, 25,
        round(rate * 100, 1) if rate is not None else None,
        "Share of income left after expenses and EMIs." if rate is not None else "Add income to measure this.")

    if goals_total > 0:
        add("goals", "Goals on track", 20 * goals_on_track / goals_total, 20,
            f"{goals_on_track}/{goals_total}", "Goals whose projection reaches the inflated target.")
    else:
        add("goals", "Goals on track", 10, 20, None, "No goals yet, so this is scored as neutral.")

    total = round(sum(c["points"] for c in comps))
    band = "Strong" if total >= 80 else "Healthy" if total >= 60 else "Needs attention" if total >= 40 else "At risk"
    return {
        "score": total, "band": band, "components": comps,
        "metrics": {
            "emergency_months": round(ef, 1) if ef is not None else None,
            "dti_pct": round(dti * 100, 1) if dti is not None else None,
            "savings_rate_pct": round(rate * 100, 1) if rate is not None else None,
            "monthly_surplus": round(income - expenses - emis, 2),
        },
    }
