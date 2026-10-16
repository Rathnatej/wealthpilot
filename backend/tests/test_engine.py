from datetime import date

import pytest

import engine
from schemas import ScenarioDelta, TwinInput


def test_future_value():
    assert engine.future_value(1_000_000, 0.06, 10) == pytest.approx(1790847.70, abs=0.01)


def test_zero_return_is_plain_sum():
    twin = TwinInput(current_corpus=1000, monthly_sip=100, annual_return=0, years=1)
    assert engine.project(twin).final_corpus == 2200


def test_extra_sip_beats_baseline():
    twin = TwinInput(current_corpus=500000, monthly_sip=20000)
    base, res = engine.simulate(twin, [ScenarioDelta(name="A", sip_delta=10000)])
    assert res[0].final_corpus > base.final_corpus


def test_new_loan_lowers_corpus():
    twin = TwinInput(current_corpus=500000, monthly_sip=20000)
    base, res = engine.simulate(twin, [ScenarioDelta(name="L", new_loan_emi=15000, new_loan_months=60)])
    assert res[0].final_corpus < base.final_corpus


def test_simulate_does_not_mutate_input():
    twin = TwinInput(current_corpus=1, monthly_sip=1)
    before = twin.model_dump()
    engine.simulate(twin, [ScenarioDelta(sip_delta=5)])
    assert twin.model_dump() == before


def test_xirr_one_year_ten_percent():
    r = engine.xirr([date(2024, 1, 1), date(2025, 1, 1)], [-1000, 1100])
    assert r == pytest.approx(0.10, abs=0.002)


def test_xirr_needs_both_signs():
    with pytest.raises(ValueError):
        engine.xirr([date(2024, 1, 1), date(2025, 1, 1)], [100, 200])
