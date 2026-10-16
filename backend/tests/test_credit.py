import pytest

from credit import CardIn, CreditRequest, analyze, pay_to_reach, score_band, simulate_payoff


def card(name="HDFC", limit=100000, balance=60000, apr=42.0, min_due=None):
    return CardIn(name=name, limit=limit, balance=balance, apr=apr, min_due=min_due)


def test_score_bands():
    assert score_band(None) is None
    b = score_band(620)
    assert b["name"] == "Fair" and b["next_band"] == "Good" and b["points_to_next_band"] == 30
    assert score_band(780)["next_band"] is None


def test_pay_to_reach_target():
    c = card(limit=100000, balance=60000)
    assert pay_to_reach(c, 0.30) == 30000.0
    assert pay_to_reach(card(balance=10000), 0.30) == 0.0


def test_utilization_and_actions_are_computed_not_guessed():
    r = analyze(CreditRequest(
        score=640, monthly_income=80000, cards=[card()], missed_payments_12m=1,
        oldest_account_years=3, enquiries_6m=4,
    ))
    assert r["utilization_pct"] == 60.0
    assert r["band"]["name"] == "Fair"
    by = {f["key"]: f for f in r["factors"]}
    assert by["payment_history"]["status"] == "warn"
    assert by["utilization"]["status"] == "bad"
    assert by["enquiries"]["status"] == "bad"
    assert r["cards"][0]["pay_to_30pct"] == 30000.0
    titles = " ".join(a["title"] for a in r["actions"])
    assert "30%" in titles and "Pause new credit applications" in titles
    # sorted by priority; overdue/autopay is first
    assert r["actions"][0]["title"].startswith("Clear anything overdue")


def test_clean_profile_has_no_alarm():
    r = analyze(CreditRequest(score=790, monthly_income=100000, cards=[card(balance=5000)],
                              oldest_account_years=8, enquiries_6m=0))
    assert r["factor_counts"]["bad"] == 0
    assert r["payoff"]["avalanche"]["months"] >= 1


def test_avalanche_never_costs_more_interest_than_snowball_and_beats_minimums():
    cards = [card("A", 100000, 80000, 48), card("B", 100000, 20000, 20)]
    av = simulate_payoff(cards, 20000, "avalanche")
    sn = simulate_payoff(cards, 20000, "snowball")
    mn = simulate_payoff(cards, 20000, "minimum")
    assert av["cleared"] and sn["cleared"]
    assert av["total_interest"] <= sn["total_interest"] + 0.01
    assert av["total_interest"] < mn["total_interest"]
    assert av["months_to_30pct"] is not None


def test_budget_below_minimums_is_raised_to_minimums():
    cards = [card(balance=50000)]
    low = simulate_payoff(cards, 1, "avalanche")
    assert low["months"] > 0 and low["total_interest"] > 0


def test_no_cards_ok():
    r = analyze(CreditRequest(score=700))
    assert r["utilization_pct"] is None and r["payoff"] is None


def test_endpoint_validates_and_works(client):
    ok = client.post("/credit/analyze", json={
        "score": 700, "monthly_income": 50000,
        "cards": [{"name": "X", "limit": 50000, "balance": 40000}],
    })
    assert ok.status_code == 200
    assert ok.json()["utilization_pct"] == 80.0
    assert client.post("/credit/analyze", json={"score": 1200}).status_code == 422
    assert client.post("/credit/analyze", json={"cards": [{"name": "X", "limit": 0, "balance": 1}]}).status_code == 422
