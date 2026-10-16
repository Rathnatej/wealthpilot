"""Explanations. The engine produces every number; AI text is only accepted if it uses no other numbers."""
import json
import logging
import re
from datetime import date

import ai_service
import engine
from planners import fmt_inr, stepup_projection
from schemas import ScenarioDelta, SimulationResult, TwinInput

log = logging.getLogger("wealthpilot.narrator")

NUM_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
ADVICE_RE = re.compile(
    r"\b(you should|you must|i recommend|we recommend|i suggest|buy|sell|guarantee[ds]?|will definitely)\b", re.I)
DISCLAIMER = "Illustrative projections based on assumed returns. Educational only, not investment advice."

NARRATE_SYSTEM = """You are WealthPilot's educational explainer (SEBI Level 1-2: education and scenario analysis only).
Rules:
- Use ONLY numbers that appear in the FACTS JSON, copied exactly as written. Never calculate, round or invent numbers.
- Do not recommend, advise, predict or promise anything. Never name specific stocks or funds.
- Describe what the numbers show and why they differ, in 3-5 short plain sentences.
- Write plain prose: no numbered lists and no headings."""


def numbers(text: str) -> set[float]:
    return {round(float(n.replace(",", "")), 2) for n in NUM_RE.findall(text)}


def numbers_ok(text: str, facts: dict) -> bool:
    """True when every number in `text` also appears in `facts`."""
    return numbers(text) <= numbers(json.dumps(facts, ensure_ascii=False, default=str))


def narrate(kind: str, facts: dict, template: str, use_ai: bool = True, context: str = "") -> tuple[str, str]:
    if use_ai and ai_service.configured():
        try:
            prompt = (f"Kind: {kind}\n{('Concept: ' + context + chr(10)) if context else ''}"
                      f"FACTS:\n{json.dumps(facts, ensure_ascii=False, default=str)}")
            text = (ai_service.generate(NARRATE_SYSTEM, prompt) or "").strip()
            if text and numbers_ok(text, facts) and not ADVICE_RE.search(text):
                return text, "ai"
            log.info("AI narration rejected by guard (%s); using template", kind)
        except Exception:
            log.exception("AI narration failed (%s)", kind)
    return template, "template"


def _drivers(s: ScenarioDelta) -> list[str]:
    d = []
    if s.sip_delta:
        d.append(f"monthly SIP {'up' if s.sip_delta > 0 else 'down'} by {fmt_inr(abs(s.sip_delta))}")
    if s.new_loan_emi:
        d.append(f"a new loan EMI of {fmt_inr(s.new_loan_emi)} for {s.new_loan_months} months, "
                 f"paid out of monthly investing")
    if s.lump_sum:
        d.append(f"a lump sum of {fmt_inr(s.lump_sum)} invested today")
    if s.return_delta:
        d.append(f"return changed by {s.return_delta * 100:+.1f} percentage points")
    return d


def scenario_summary(base: TwinInput, scenarios: list[ScenarioDelta], baseline: SimulationResult,
                     results: list[SimulationResult], notes: list[str]) -> tuple[dict, str]:
    from planners import contributed
    b = baseline.final_corpus
    bc = contributed(base)
    facts = {"horizon_years": base.years, "annual_return_pct": round(base.annual_return * 100, 2),
             "baseline_final": b, "baseline_final_fmt": fmt_inr(b), "baseline_contributed": bc,
             "baseline_growth": round(b - bc, 2), "scenarios": [], "assumptions": notes}
    lines = [f"Over {base.years} years at an assumed {base.annual_return * 100:.1f}% annual return, the baseline "
             f"grows to {fmt_inr(b)}: {fmt_inr(bc)} put in plus {fmt_inr(b - bc)} of growth."]
    for s, r in zip(scenarios, results):
        diff = round(r.final_corpus - b, 2)
        pct = round(diff / b * 100, 1) if b else None
        sc = contributed(base, s)
        drivers = _drivers(s)
        facts["scenarios"].append({
            "name": s.name, "drivers": drivers, "final": r.final_corpus, "final_fmt": fmt_inr(r.final_corpus),
            "difference": diff, "difference_fmt": fmt_inr(diff), "difference_pct": pct,
            "contributed": sc, "growth": round(r.final_corpus - sc, 2)})
        direction = "higher" if diff >= 0 else "lower"
        tail = f" ({abs(pct)}%)" if pct is not None else ""
        lines.append(f"{s.name} ({'; '.join(drivers) or 'no changes'}) ends at {fmt_inr(r.final_corpus)}, "
                     f"{fmt_inr(abs(diff))} {direction} than the baseline{tail}. It puts in {fmt_inr(sc)} in "
                     f"total and earns {fmt_inr(r.final_corpus - sc)} of growth.")
    lines.extend(notes)
    lines.append(DISCLAIMER)
    return facts, " ".join(lines)


def stepup_summary(req, res: dict) -> tuple[dict, str]:
    facts = {"monthly_sip": req.monthly_sip, "step_up_pct": req.step_up_pct, "years": req.years,
             "annual_return_pct": req.annual_return_pct, "final_flat": res["final_flat"],
             "final_step_up": res["final_step_up"], "extra_wealth": res["extra_wealth"],
             "invested_flat": res["invested_flat"], "invested_step_up": res["invested_step_up"],
             "final_year_sip": res["final_year_sip"]}
    t = (f"Investing {fmt_inr(req.monthly_sip)} a month for {req.years} years at an assumed "
         f"{req.annual_return_pct}% return reaches {fmt_inr(res['final_flat'])}. Raising the SIP by "
         f"{req.step_up_pct}% each year reaches {fmt_inr(res['final_step_up'])}, which is "
         f"{fmt_inr(res['extra_wealth'])} more. The step-up version puts in {fmt_inr(res['invested_step_up'])} "
         f"instead of {fmt_inr(res['invested_flat'])}, and the monthly SIP in the last year is "
         f"{fmt_inr(res['final_year_sip'])}. {DISCLAIMER}")
    return facts, t


def retirement_summary(req, res: dict) -> tuple[dict, str]:
    facts = {k: res[k] for k in ("years_to_retirement", "retirement_years", "expenses_at_retirement_monthly",
                                 "corpus_needed", "projected_corpus", "gap", "on_track", "required_monthly_sip",
                                 "depletion_age", "fire_number_today")}
    facts.update({"retirement_age": req.retirement_age, "life_expectancy": req.life_expectancy,
                  "monthly_expenses_today": req.monthly_expenses, "inflation_pct": req.inflation_pct,
                  "planned_monthly_sip": req.monthly_sip})
    t = (f"Today's expenses of {fmt_inr(req.monthly_expenses)} a month grow to "
         f"{fmt_inr(res['expenses_at_retirement_monthly'])} a month by age {req.retirement_age} at "
         f"{req.inflation_pct}% inflation. Funding {res['retirement_years']} years of retirement needs about "
         f"{fmt_inr(res['corpus_needed'])} at retirement. The current plan projects "
         f"{fmt_inr(res['projected_corpus'])}")
    if res["on_track"]:
        t += ", which covers that need."
    else:
        t += f", which falls short by {fmt_inr(res['gap'])}."
        t += (f" Closing the gap would take a starting SIP of {fmt_inr(res['required_monthly_sip'])} a month "
              f"(the plan assumes {fmt_inr(req.monthly_sip)}).")
    if res["depletion_age"]:
        t += f" At this pace the money runs out around age {res['depletion_age']}."
    return facts, f"{t} {DISCLAIMER}"


def loan_summary(req, res: dict) -> tuple[dict, str]:
    a, b = res["prepay"], res["invest"]
    facts = {"emi": res["emi"], "prepay_final_net_worth": a["final_net_worth"],
             "invest_final_net_worth": b["final_net_worth"], "difference": res["difference"],
             "interest_saved": res["interest_saved"], "remaining_months": req.remaining_months,
             "prepay_loan_closed_month": a["loan_closed_month"], "breakeven_return": res["breakeven_return"],
             "winner": res["winner"], "invest_return_pct": req.invest_return_pct}
    closes = (f"the loan closes in month {a['loan_closed_month']} instead of month {req.remaining_months}, saving "
              f"{fmt_inr(res['interest_saved'])} of interest" if a["loan_closed_month"] is not None
              else "the loan stays open")
    be = (f" The break-even investment return is about {res['breakeven_return'] * 100:.1f}% a year: above it "
          f"investing comes out ahead on these assumptions, below it prepaying does."
          if res["breakeven_return"] is not None else "")
    t = (f"If the money goes to the loan, {closes}; net worth at the end is {fmt_inr(a['final_net_worth'])}. "
         f"If it is invested at an assumed {req.invest_return_pct}% instead, net worth at the end is "
         f"{fmt_inr(b['final_net_worth'])}. On these assumptions the "
         f"{'prepay' if res['winner'] == 'prepay' else 'invest'} path ends {fmt_inr(res['difference'])} ahead.{be} "
         f"Interest saved on a loan is certain, while investment returns are not, and this ignores tax. "
         f"{DISCLAIMER}")
    return facts, t


def risk_summary(goal_name: str, mc: dict, status: dict) -> tuple[dict, str]:
    facts = {"goal": goal_name, "probability_pct": round(mc["probability"] * 100, 1),
             "inflated_target": mc["target"], "median_outcome": mc["p50"], "weak_outcome_p10": mc["p10"],
             "strong_outcome_p90": mc["p90"], "simulated_paths": mc["paths"],
             "volatility_pct": round(mc["volatility"] * 100, 1), "years_left": status["years_left"]}
    t = (f"In {mc['paths']} simulated market paths, {facts['probability_pct']}% reached the inflated target of "
         f"{fmt_inr(mc['target'])} for {goal_name}. The median outcome was {fmt_inr(mc['p50'])}; the weaker 10% of "
         f"paths ended below {fmt_inr(mc['p10'])} and the stronger 10% above {fmt_inr(mc['p90'])}. This assumes "
         f"{facts['volatility_pct']}% yearly volatility and is a what-if range, not a forecast.")
    return facts, t


def insights_summary(f: dict) -> tuple[dict, str]:
    if not f.get("months"):
        return f, "No dated transactions could be read, so there is nothing to summarise."
    top = f["top_categories"]
    t = [f"Across {len(f['months'])} month(s) up to {f['latest_month']}, the largest spending category was "
         f"{top[0]['category']} at {fmt_inr(top[0]['total'])} ({top[0]['share_pct']}% of spending)."]
    for c in f["changes"][:2]:
        if c["change_pct"] is None:
            t.append(f"{c['category']} appeared in {f['latest_month']} at {fmt_inr(c['latest'])}.")
        else:
            verb = "rose" if c["change"] > 0 else "fell"
            t.append(f"{c['category']} {verb} from {fmt_inr(c['previous'])} in {f['previous_month']} to "
                     f"{fmt_inr(c['latest'])} in {f['latest_month']} ({c['change_pct']:+}%).")
    if f.get("savings_rate_latest_pct") is not None:
        t.append(f"In {f['latest_month']}, spending was {fmt_inr(f['spend_by_month'][f['latest_month']])} against "
                 f"income of {fmt_inr(f['income_latest_month'])}, a {f['savings_rate_latest_pct']}% savings rate.")
    return f, " ".join(t) + " These are descriptions of past spending, not advice."


# ---------------- Tutor ----------------
DEFINITIONS = {
    "xirr": "XIRR is the annualised return of an investment where money goes in and out on different dates. "
            "Unlike a simple percentage gain, it accounts for when each rupee was invested.",
    "sip_step_up": "A SIP step-up raises the monthly instalment by a fixed percentage every year, so contributions "
                   "keep pace with income growth.",
    "expense_ratio": "The expense ratio is the yearly fee a mutual fund charges, as a percentage of your money in the "
                     "fund. It is deducted from returns, and small differences compound over long periods.",
    "inflation": "Inflation is the steady rise in prices, which reduces what a rupee can buy over time.",
    "emergency_fund": "An emergency fund is cash kept aside to cover living expenses if income stops or a surprise "
                      "bill arrives. It is usually measured in months of expenses.",
    "compounding": "Compounding means earning returns on your earlier returns, not just on the money you put in, so "
                   "growth accelerates over time.",
}


def _nz(x: float, default: float) -> float:
    return x if x and x > 0 else default


def tutor_lesson(term: str, v: dict) -> tuple[dict, str]:
    ret = v["ret"]
    notes = ["These examples use sample numbers because you have not saved a twin yet."] if v["used_sample"] else []
    d = DEFINITIONS[term]
    if term == "xirr":
        sip = _nz(v["sip"], 10000)
        res = engine.project(TwinInput(current_corpus=0, monthly_sip=sip, annual_return=ret, years=1))
        dates = [date(2025, m, 1) for m in range(1, 13)] + [date(2026, 1, 1)]
        x = engine.xirr(dates, [-sip] * 12 + [res.final_corpus])
        facts = {"monthly_sip": sip, "months": 12, "total_invested": round(sip * 12, 2),
                 "value_after_12_months": res.final_corpus, "gain": round(res.final_corpus - sip * 12, 2),
                 "xirr_pct": round(x * 100, 2), "assumed_annual_return_pct": round(ret * 100, 2), "notes": notes}
        ex = (f"Example: investing {fmt_inr(sip)} every month for 12 months at an assumed {ret * 100:.1f}% annual "
              f"return puts in {fmt_inr(facts['total_invested'])} and grows to {fmt_inr(res.final_corpus)}, a gain "
              f"of {fmt_inr(facts['gain'])}. Because each instalment is invested for a different length of time, "
              f"the XIRR works out to {facts['xirr_pct']}% a year.")
    elif term == "sip_step_up":
        sip = _nz(v["sip"], 10000)
        r = stepup_projection(0, sip, 0.10, ret, 10)
        facts = {"monthly_sip": sip, "step_up_pct": 10, "years": 10, "final_flat": r["final_flat"],
                 "final_step_up": r["final_step_up"], "extra_wealth": r["extra_wealth"],
                 "final_year_sip": r["final_year_sip"], "notes": notes}
        ex = (f"Example: a flat SIP of {fmt_inr(sip)} for 10 years at an assumed {ret * 100:.1f}% return reaches "
              f"{fmt_inr(r['final_flat'])}. Stepping it up 10% every year reaches {fmt_inr(r['final_step_up'])}, "
              f"which is {fmt_inr(r['extra_wealth'])} more; by year 10 the instalment is "
              f"{fmt_inr(r['final_year_sip'])} a month.")
    elif term == "expense_ratio":
        corpus, sip = v["corpus"], v["sip"]
        if corpus <= 0 and sip <= 0:
            corpus, sip = 500000, 10000
            notes = notes or ["Sample numbers were used."]
        low = engine.project(TwinInput(current_corpus=corpus, monthly_sip=sip, annual_return=max(ret - 0.005, -0.5), years=10))
        high = engine.project(TwinInput(current_corpus=corpus, monthly_sip=sip, annual_return=max(ret - 0.015, -0.5), years=10))
        facts = {"current_corpus": corpus, "monthly_sip": sip, "years": 10, "low_expense_ratio_pct": 0.5,
                 "high_expense_ratio_pct": 1.5, "final_with_low": low.final_corpus,
                 "final_with_high": high.final_corpus, "cost_of_higher_fee": round(low.final_corpus - high.final_corpus, 2),
                 "gross_return_pct": round(ret * 100, 2), "notes": notes}
        ex = (f"Example: with {fmt_inr(corpus)} invested and {fmt_inr(sip)} added monthly for 10 years at a "
              f"{ret * 100:.1f}% gross return, a fund charging 0.5% a year ends at {fmt_inr(low.final_corpus)}, "
              f"while one charging 1.5% ends at {fmt_inr(high.final_corpus)}. The higher fee costs "
              f"{fmt_inr(facts['cost_of_higher_fee'])}.")
    elif term == "inflation":
        exp = _nz(v["expenses"], 40000)
        fv = engine.future_value(exp, 0.06, 10)
        facts = {"monthly_expenses_today": exp, "years": 10, "inflation_pct": 6, "monthly_expenses_future": fv,
                 "notes": notes}
        ex = (f"Example: monthly expenses of {fmt_inr(exp)} today become about {fmt_inr(fv)} in 10 years at 6% "
              f"inflation, so the same lifestyle needs more money later.")
    elif term == "emergency_fund":
        exp = _nz(v["expenses"], 40000)
        cash = v["cash"]
        facts = {"monthly_expenses": exp, "target_months": 6, "target_amount": round(exp * 6, 2),
                 "cash_held": cash, "months_covered": round(cash / exp, 1), "notes": notes}
        ex = (f"Example: with monthly expenses of {fmt_inr(exp)}, a 6-month fund is {fmt_inr(exp * 6)}. You hold "
              f"{fmt_inr(cash)} in cash, which covers {facts['months_covered']} months.")
    else:  # compounding
        corpus = _nz(v["corpus"], 100000)
        comp = engine.project(TwinInput(current_corpus=corpus, monthly_sip=0, annual_return=ret, years=10)).final_corpus
        simple = round(corpus * (1 + ret * 10), 2)
        facts = {"starting_amount": corpus, "years": 10, "annual_return_pct": round(ret * 100, 2),
                 "with_compounding": comp, "with_simple_interest": simple,
                 "extra_from_compounding": round(comp - simple, 2), "notes": notes}
        ex = (f"Example: {fmt_inr(corpus)} left alone for 10 years at an assumed {ret * 100:.1f}% return grows to "
              f"{fmt_inr(comp)} with monthly compounding, versus {fmt_inr(simple)} with simple interest. "
              f"Compounding adds {fmt_inr(facts['extra_from_compounding'])}.")
    return facts, f"{d} {ex} {' '.join(notes)} {DISCLAIMER}".replace("  ", " ")
