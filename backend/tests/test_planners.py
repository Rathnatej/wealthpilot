from datetime import date

import pytest

import engine
import narrator
import planners
from intent import ADVICE_RE, parse_rules, scenario_from_params
from schemas import ScenarioDelta, TwinInput


# ---------------- emi / contributions ----------------
def test_emi_known_value_and_zero_rate():
    assert planners.emi(1_000_000, 0.095, 60) == pytest.approx(21_002, abs=5)
    assert planners.emi(120_000, 0.0, 12) == 10_000


def test_contributed_matches_engine_when_no_growth():
    twin = TwinInput(current_corpus=1000, monthly_sip=100, annual_return=0, years=2)
    d = ScenarioDelta(sip_delta=50, new_loan_emi=120, new_loan_months=6, lump_sum=500)
    assert engine.project(twin, "x", d.sip_delta, d.new_loan_emi, d.new_loan_months, d.lump_sum).final_corpus \
        == planners.contributed(twin, d)


# ---------------- monte carlo ----------------
def test_monte_carlo_is_deterministic():
    a = planners.monte_carlo_goal(100000, 5000, 0.10, 0.15, 120, 1_500_000)
    b = planners.monte_carlo_goal(100000, 5000, 0.10, 0.15, 120, 1_500_000)
    assert a == b


def test_monte_carlo_zero_volatility_matches_deterministic_projection():
    st = engine.goal_status(1_000_000, 0.0, 100000, 5000, 0.10, date(2035, 1, 1), date(2025, 1, 1))
    mc = planners.monte_carlo_goal(100000, 5000, 0.10, 0.0, 120, st["projected_value"] * 0.99)
    assert mc["p50"] == pytest.approx(st["projected_value"], rel=1e-6)
    assert mc["probability"] == 1.0
    assert planners.monte_carlo_goal(100000, 5000, 0.10, 0.0, 120, st["projected_value"] * 1.01)["probability"] == 0.0


def test_monte_carlo_more_saving_means_higher_probability():
    lo = planners.monte_carlo_goal(100000, 3000, 0.10, 0.15, 120, 1_500_000)["probability"]
    hi = planners.monte_carlo_goal(100000, 9000, 0.10, 0.15, 120, 1_500_000)["probability"]
    assert 0 <= lo < hi <= 1


# ---------------- step-up ----------------
def test_stepup_beats_flat_and_zero_step_equals_flat():
    r = planners.stepup_projection(0, 10000, 0.10, 0.12, 10)
    assert r["final_step_up"] > r["final_flat"] and r["extra_wealth"] > 0
    z = planners.stepup_projection(0, 10000, 0.0, 0.12, 10)
    assert z["final_step_up"] == z["final_flat"]
    assert r["final_flat"] == pytest.approx(engine.project(
        TwinInput(current_corpus=0, monthly_sip=10000, annual_return=0.12, years=10)).final_corpus, abs=0.5)


# ---------------- retirement ----------------
def _plan(**kw):
    base = dict(current_age=30, retirement_age=60, life_expectancy=85, monthly_expenses=50000, inflation=0.06,
                pre_return=0.11, post_return=0.07, current_corpus=0, monthly_sip=0)
    return planners.retirement_plan(**{**base, **kw})


def test_retirement_need_is_exactly_enough_to_fund_drawdown():
    p = _plan()
    g = (1 + 0.11 / 12) ** (30 * 12)
    funded = _plan(current_corpus=p["corpus_needed"] / g)
    assert funded["on_track"] is True and funded["depletion_age"] is None
    assert funded["series"][-1]["corpus"] < 5  # fully used by life expectancy


def test_retirement_required_sip_closes_the_gap_and_depletion_detected():
    p = _plan(monthly_sip=5000)
    assert p["on_track"] is False and p["gap"] > 0 and p["depletion_age"] is not None
    ok = _plan(monthly_sip=p["required_monthly_sip"])
    assert ok["projected_corpus"] >= ok["corpus_needed"] - 1


def test_retirement_step_up_lowers_required_starting_sip():
    assert _plan(step_up=0.10)["required_monthly_sip"] < _plan()["required_monthly_sip"]


# ---------------- loan vs invest ----------------
def test_loan_vs_invest_winner_flips_around_breakeven():
    base = dict(principal=1_000_000, annual_rate=0.09, months=120, emi_amount=None, lump_sum=200_000, extra_monthly=0)
    low = planners.loan_vs_invest(**base, invest_return=0.04)
    high = planners.loan_vs_invest(**base, invest_return=0.15)
    assert low["winner"] == "prepay" and high["winner"] == "invest"
    be = low["breakeven_return"]
    assert be is not None and 0.04 < be < 0.15
    assert planners.loan_vs_invest(**base, invest_return=be)["difference"] < 5_000
    assert low["interest_saved"] > 0 and low["prepay"]["loan_closed_month"] < 120


def test_loan_fully_prepaid_closes_immediately():
    r = planners.loan_vs_invest(100_000, 0.10, 24, None, 100_000, 0, 0.10)
    assert r["prepay"]["loan_closed_month"] == 0 and r["prepay"]["loan_balance"] == 0


# ---------------- health score ----------------
def test_health_score_bounds_and_ordering():
    strong = planners.health_score(200000, 80000, 20000, 600000, 2, 2)
    weak = planners.health_score(100000, 95000, 60000, 10000, 2, 0)
    assert 0 <= weak["score"] < strong["score"] <= 100
    assert strong["band"] in ("Strong", "Healthy") and weak["band"] == "At risk"
    assert sum(c["max"] for c in strong["components"]) == 100
    missing = planners.health_score(0, 0, 0, 0, 0, 0)
    assert 0 <= missing["score"] <= 100 and missing["metrics"]["dti_pct"] is None


# ---------------- number guard ----------------
FACTS = {"final": 6297000.5, "final_fmt": "₹62.97 L", "years": 10, "drivers": ["SIP up by ₹10,000"]}


def test_number_guard_accepts_only_known_numbers():
    assert narrator.numbers_ok("It reaches ₹62.97 L after 10 years, with ₹10,000 more SIP.", FACTS)
    assert narrator.numbers_ok("Growth compounds over time.", FACTS)
    assert not narrator.numbers_ok("It reaches ₹70 L after 10 years.", FACTS)
    assert not narrator.numbers_ok("About 25% higher.", FACTS)


def test_narrate_falls_back_to_template_when_ai_invents_numbers(monkeypatch):
    monkeypatch.setattr(narrator.ai_service, "configured", lambda: True)
    monkeypatch.setattr(narrator.ai_service, "generate", lambda s, p, t=0.2: "You will have ₹99 Cr.")
    assert narrator.narrate("x", FACTS, "TEMPLATE") == ("TEMPLATE", "template")
    monkeypatch.setattr(narrator.ai_service, "generate", lambda s, p, t=0.2: "You should buy index funds.")
    assert narrator.narrate("x", FACTS, "TEMPLATE")[1] == "template"
    monkeypatch.setattr(narrator.ai_service, "generate", lambda s, p, t=0.2: "It reaches ₹62.97 L in 10 years.")
    assert narrator.narrate("x", FACTS, "TEMPLATE")[1] == "ai"
    assert narrator.narrate("x", FACTS, "TEMPLATE", use_ai=False) == ("TEMPLATE", "template")


def test_narrate_survives_ai_errors(monkeypatch):
    monkeypatch.setattr(narrator.ai_service, "configured", lambda: True)

    def boom(*a, **k):
        raise RuntimeError("quota")
    monkeypatch.setattr(narrator.ai_service, "generate", boom)
    assert narrator.narrate("x", FACTS, "TEMPLATE")[1] == "template"


# ---------------- intent rules ----------------
def test_rules_parse_loan_with_tenure_and_rate():
    p = parse_rules("What if I take a ₹10L loan at 8.5% for 5 years?").params
    assert p.loan_amount == 1_000_000 and p.loan_months == 60 and p.loan_rate_pct == 8.5


def test_rules_parse_sip_changes_and_lump_sum_and_emi():
    assert parse_rules("increase my SIP by 10,000").params.sip_change == 10000
    assert parse_rules("what if I reduce SIP by 5k").params.sip_change == -5000
    assert parse_rules("I get a bonus of 2 lakh").params.lump_sum == 200000
    e = parse_rules("add an EMI of 15000 for 3 years").params
    assert e.loan_emi == 15000 and e.loan_months == 36 and e.loan_amount is None


def test_rules_ignore_bare_small_numbers_and_unknown_text():
    assert parse_rules("how are you").params is None
    assert parse_rules("loan for 5 years").params is None


def test_advice_requests_are_refused():
    for q in ["Which stock should I buy?", "what mutual fund is best", "should I sell my shares",
              "give me stock tips", "best funds for 2026"]:
        assert ADVICE_RE.search(q), q
        assert parse_rules(q).refused


def test_scenario_from_params_computes_emi_with_assumptions():
    s, notes = scenario_from_params(parse_rules("take a 10 lakh loan").params)
    assert s.new_loan_months == 60 and 20_000 < s.new_loan_emi < 22_000
    assert any("Assumed" in n for n in notes)
