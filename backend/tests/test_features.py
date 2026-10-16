import io
import re
import uuid
from datetime import date, timedelta

import features
import narrator
from feature_schemas import IntentParams, LLMIntent

TWIN_BODY = {"twin": {"current_corpus": 500000, "monthly_sip": 20000},
             "scenarios": [{"name": "A", "sip_delta": 10000}]}


def _save_twin(client, h, **kw):
    body = {"monthly_income": 100000, "monthly_expenses": 60000, "monthly_sip": 10000, "annual_return": 0.12,
            "assets": [{"kind": "cash", "name": "Bank", "value": 50000}],
            "liabilities": [{"name": "Car", "principal": 300000, "interest_rate": 0.09,
                             "remaining_months": 36, "monthly_emi": 50000}], **kw}
    r = client.post("/twin", json=body, headers=h)
    assert r.status_code == 201
    return r.json()


# ---------------- copilot ----------------
def test_copilot_loan_runs_engine_and_explains(client, auth_headers):
    r = client.post("/ai/copilot", json={"query": "What if I take a ₹10L loan for 5 years?"}, headers=auth_headers)
    d = r.json()
    assert r.status_code == 200 and not d["refused"]
    assert d["parsed_by"] == "rules" and d["source"] == "template"
    assert d["scenario"]["new_loan_months"] == 60 and 20_000 < d["scenario"]["new_loan_emi"] < 22_000
    sim = d["simulation"]
    assert sim["scenarios"][0]["final_corpus"] < sim["baseline"]["final_corpus"]
    assert "lower" in d["explanation"] and "Assumed" in d["explanation"]


def test_copilot_uses_saved_twin_instead_of_sample(client, auth_headers):
    _save_twin(client, auth_headers)
    d = client.post("/ai/copilot", json={"query": "increase my SIP by 5000"}, headers=auth_headers).json()
    assert d["simulation"]["baseline"]["series"][0]["corpus"] == 50000
    assert not any("sample numbers" in a for a in d["assumptions"])


def test_copilot_refuses_stock_picking_without_calling_ai(client, auth_headers, monkeypatch):
    def fail(*a, **k):
        raise AssertionError("AI must not be called for refused queries")
    monkeypatch.setattr(features.ai_service, "configured", lambda: True)
    monkeypatch.setattr(features.ai_service, "parse_intent_llm", fail)
    d = client.post("/ai/copilot", json={"query": "Which stock should I buy now?"}, headers=auth_headers).json()
    assert d["refused"] and d["simulation"] is None


def test_copilot_unparseable_gives_hint(client, auth_headers):
    d = client.post("/ai/copilot", json={"query": "tell me something nice"}, headers=auth_headers).json()
    assert not d["refused"] and d["scenario"] is None and "Try" in d["message"]


def test_copilot_ai_path_accepts_clean_text_and_rejects_invented_numbers(client, auth_headers, monkeypatch):
    monkeypatch.setattr(features.ai_service, "configured", lambda: True)
    monkeypatch.setattr(narrator.ai_service, "configured", lambda: True)
    monkeypatch.setattr(features.ai_service, "parse_intent_llm",
                        lambda q: LLMIntent(params=IntentParams(sip_change=10000)))
    monkeypatch.setattr(narrator.ai_service, "generate", lambda s, p, t=0.2: "The extra SIP adds growth over time.")
    ok = client.post("/ai/copilot", json={"query": "more sip please"}, headers=auth_headers).json()
    assert ok["parsed_by"] == "ai" and ok["source"] == "ai"
    assert ok["scenario"]["sip_delta"] == 10000

    monkeypatch.setattr(narrator.ai_service, "generate", lambda s, p, t=0.2: "It becomes ₹123456789 for sure.")
    bad = client.post("/ai/copilot", json={"query": "more sip please"}, headers=auth_headers).json()
    assert bad["source"] == "template" and "123456789" not in bad["explanation"]


def test_copilot_falls_back_to_rules_when_llm_fails(client, auth_headers, monkeypatch):
    monkeypatch.setattr(features.ai_service, "configured", lambda: True)

    def boom(q):
        raise RuntimeError("down")
    monkeypatch.setattr(features.ai_service, "parse_intent_llm", boom)
    d = client.post("/ai/copilot", json={"query": "raise SIP by 10k"}, headers=auth_headers).json()
    assert d["parsed_by"] == "rules" and d["scenario"]["sip_delta"] == 10000


# ---------------- scenario explainer ----------------
def test_explain_scenario_is_public_and_template_only_when_anonymous(client, monkeypatch):
    monkeypatch.setattr(narrator.ai_service, "configured", lambda: True)

    def fail(*a, **k):
        raise AssertionError("anonymous callers must not trigger AI")
    monkeypatch.setattr(narrator.ai_service, "generate", fail)
    r = client.post("/explain/scenario", json=TWIN_BODY)
    assert r.status_code == 200 and r.json()["source"] == "template"
    assert "baseline" in r.json()["explanation"] and "higher" in r.json()["explanation"]
    many = {**TWIN_BODY, "scenarios": [{"name": str(i)} for i in range(5)]}
    assert client.post("/explain/scenario", json=many).status_code == 422


# ---------------- tutor ----------------
def test_tutor_all_terms_with_and_without_twin(client, auth_headers):
    for term in ["xirr", "sip_step_up", "expense_ratio", "inflation", "emergency_fund", "compounding"]:
        r = client.post("/ai/tutor", json={"term": term}, headers=auth_headers)
        assert r.status_code == 200, term
        assert r.json()["definition"] in r.json()["explanation"] and "Example" in r.json()["explanation"]
    x = client.post("/ai/tutor", json={"term": "xirr"}, headers=auth_headers).json()["facts"]["xirr_pct"]
    assert 12.0 < x < 13.5
    _save_twin(client, auth_headers)
    e = client.post("/ai/tutor", json={"term": "emergency_fund"}, headers=auth_headers).json()
    assert e["facts"]["cash_held"] == 50000 and "sample numbers" not in e["explanation"]
    assert client.post("/ai/tutor", json={"term": "bogus"}, headers=auth_headers).status_code == 422
    assert client.post("/ai/tutor", json={"term": "xirr"}).status_code == 401


# ---------------- insights ----------------
TXNS = [
    {"date": "05/02/2025", "description": "SWIGGY", "amount": 2000, "type": "debit", "category": "food"},
    {"date": "10/02/2025", "description": "RENT", "amount": 20000, "type": "debit", "category": "rent"},
    {"date": "01/03/2025", "description": "SALARY", "amount": 80000, "type": "credit", "category": "salary"},
    {"date": "05/03/2025", "description": "ZOMATO", "amount": 3000, "type": "debit", "category": "food"},
    {"date": "10/03/2025", "description": "RENT", "amount": 20000, "type": "debit", "category": "rent"},
    {"date": "garbage", "description": "x", "amount": 1, "type": "debit", "category": "other"},
]


def test_spending_insights_month_over_month(client, auth_headers):
    r = client.post("/ai/insights", json={"transactions": TXNS}, headers=auth_headers)
    assert r.status_code == 200
    f = r.json()["facts"]
    assert f["latest_month"] == "2025-03" and f["previous_month"] == "2025-02" and f["skipped_rows"] == 1
    food = next(c for c in f["changes"] if c["category"] == "food")
    assert food["previous"] == 2000 and food["latest"] == 3000 and food["change_pct"] == 50.0
    assert f["top_categories"][0]["category"] == "rent"
    assert f["savings_rate_latest_pct"] == round((80000 - 23000) / 80000 * 100, 1)
    assert "food rose" in r.json()["explanation"] and "not advice" in r.json()["explanation"]
    assert client.post("/ai/insights", json={"transactions": []}, headers=auth_headers).status_code == 422
    assert client.post("/ai/insights", json={"transactions": TXNS}).status_code == 401


# ---------------- planners endpoints ----------------
def test_planner_endpoints_public_and_validated(client):
    s = client.post("/planners/stepup", json={"monthly_sip": 10000}).json()
    assert s["result"]["final_step_up"] > s["result"]["final_flat"] and s["source"] == "template"
    r = client.post("/planners/retirement", json={
        "current_age": 30, "retirement_age": 60, "life_expectancy": 85, "monthly_expenses": 50000}).json()
    assert r["result"]["corpus_needed"] > 0 and r["result"]["series"][0]["age"] == 30
    assert client.post("/planners/retirement", json={
        "current_age": 60, "retirement_age": 50, "life_expectancy": 85, "monthly_expenses": 1}).status_code == 422
    lv = client.post("/planners/loan-vs-invest", json={
        "principal": 1000000, "annual_rate_pct": 9, "remaining_months": 120, "lump_sum": 200000}).json()
    assert lv["result"]["winner"] in ("prepay", "invest") and "ignores tax" in lv["explanation"]
    assert client.post("/planners/loan-vs-invest", json={
        "principal": 1000000, "annual_rate_pct": 9, "remaining_months": 120}).status_code == 422


# ---------------- goal risk ----------------
def test_goal_risk_endpoint(client, auth_headers):
    g = client.post("/goals", json={
        "name": "House", "target_amount": 1000000, "target_date": str(date.today() + timedelta(days=3650)),
        "inflation_rate": 0.06, "current_saved": 100000, "monthly_contribution": 5000,
        "expected_return": 0.10}, headers=auth_headers).json()
    r = client.get(f"/goals/{g['id']}/risk", headers=auth_headers)
    d = r.json()
    assert r.status_code == 200 and 0 <= d["probability_pct"] <= 100
    assert d["p10"] <= d["p50"] <= d["p90"] and len(d["fan"]) >= 10 and "not a forecast" in d["explanation"]
    assert client.get(f"/goals/{g['id']}/risk", headers=auth_headers).json() == d  # deterministic
    low_vol = client.get(f"/goals/{g['id']}/risk?volatility=0", headers=auth_headers).json()
    assert low_vol["p10"] == low_vol["p90"]
    other = client.post("/auth/signup", json={"email": f"{uuid.uuid4().hex[:10]}@example.com",
                                              "password": "correct-horse"}).json()["access_token"]
    assert client.get(f"/goals/{g['id']}/risk", headers={"Authorization": f"Bearer {other}"}).status_code == 404
    assert client.get(f"/goals/{g['id']}/risk?volatility=5", headers=auth_headers).status_code == 422


# ---------------- dashboard / alerts ----------------
def test_dashboard_without_and_with_twin(client, auth_headers):
    d = client.get("/dashboard", headers=auth_headers).json()
    assert d["has_twin"] is False and d["health"] is None and d["alerts"][0]["id"] == "no_twin"
    _save_twin(client, auth_headers)
    d = client.get("/dashboard", headers=auth_headers).json()
    assert d["has_twin"] and 0 <= d["health"]["score"] <= 100
    ids = {a["id"] for a in d["alerts"]}
    assert {"emergency", "dti", "deficit"} <= ids
    assert client.get("/dashboard").status_code == 401


def test_goal_drift_alert(client, auth_headers):
    _save_twin(client, auth_headers)
    client.post("/goals", json={"name": "Big", "target_amount": 50_000_000,
                                "target_date": str(date.today() + timedelta(days=1825)),
                                "current_saved": 0, "monthly_contribution": 1000}, headers=auth_headers)
    ids = [a["id"] for a in client.get("/dashboard", headers=auth_headers).json()["alerts"]]
    assert any(i.startswith("goal_") for i in ids)


def test_preferences_and_digest(client, auth_user, monkeypatch):
    email, h = auth_user
    assert client.get("/me/preferences", headers=h).json()["email_alerts"] is False
    assert client.put("/me/preferences", json={"email_alerts": True}, headers=h).json()["email_alerts"] is True
    _save_twin(client, h)

    assert client.post("/alerts/send-digest").status_code == 503  # no CRON_SECRET configured
    monkeypatch.setenv("CRON_SECRET", "cron-secret-value")
    assert client.post("/alerts/send-digest", headers={"X-Cron-Secret": "wrong"}).status_code == 401
    assert client.post("/alerts/send-digest", headers={"X-Cron-Secret": "cron-secret-value"}).status_code == 503

    sent = []
    monkeypatch.setattr(features.mailer, "is_configured", lambda: True)
    monkeypatch.setattr(features.mailer, "send_email", lambda to, s, b: sent.append((to, s, b)))
    r = client.post("/alerts/send-digest", headers={"X-Cron-Secret": "cron-secret-value"})
    assert r.status_code == 200 and r.json()["failed"] == 0
    mine = [m for m in sent if m[0] == email]
    assert len(mine) == 1 and "Emergency fund is low" in mine[0][2] and "not investment advice" in mine[0][2]

    client.put("/me/preferences", json={"email_alerts": False}, headers=h)
    sent.clear()
    client.post("/alerts/send-digest", headers={"X-Cron-Secret": "cron-secret-value"})
    assert not [m for m in sent if m[0] == email]


# ---------------- sharing ----------------
def test_share_flow_public_view_and_owner_only_delete(client, auth_headers):
    body = {"title": "Plan A", **TWIN_BODY}
    r = client.post("/share", json=body, headers=auth_headers)
    assert r.status_code == 201
    token = r.json()["token"]
    assert r.json()["path"] == f"/s/{token}" and len(token) >= 12
    pub = client.get(f"/share/{token}")  # no auth
    assert pub.status_code == 200
    d = pub.json()
    assert d["title"] == "Plan A" and len(d["results"]) == 1 and d["baseline"]["series"][0]["month"] == 0
    assert "email" not in pub.text and "user_id" not in pub.text
    stranger = client.post("/auth/signup", json={"email": f"{uuid.uuid4().hex[:10]}@example.com",
                                                 "password": "correct-horse"}).json()["access_token"]
    assert client.delete(f"/share/{token}", headers={"Authorization": f"Bearer {stranger}"}).status_code == 404
    assert client.delete(f"/share/{token}", headers=auth_headers).status_code == 204
    assert client.get(f"/share/{token}").status_code == 404
    assert client.post("/share", json=body).status_code == 401
    assert client.get("/share/does-not-exist").status_code == 404
    too_many = {"title": "x", **TWIN_BODY, "scenarios": [{"name": str(i)} for i in range(4)]}
    assert client.post("/share", json=too_many, headers=auth_headers).status_code == 422


# ---------------- import holdings ----------------
def test_import_holdings_creates_snapshot_and_replaces_same_folio(client, auth_headers):
    _save_twin(client, auth_headers)
    h = {"isin": "INF123456789", "folio": "123/45", "name": "Index fund", "units": 100, "nav": 50}
    r = client.post("/twin/import-holdings", json={"holdings": [h]}, headers=auth_headers)
    assert r.status_code == 201 and r.json()["version_id"] == 2
    t = client.get("/twin/latest", headers=auth_headers).json()
    assert t["total_assets"] == 55000 and len(t["assets"]) == 2 and len(t["liabilities"]) == 1
    client.post("/twin/import-holdings", json={"holdings": [{**h, "units": 200}]}, headers=auth_headers)
    t = client.get("/twin/latest", headers=auth_headers).json()
    assert t["version_id"] == 3 and t["total_assets"] == 60000 and len(t["assets"]) == 2
    assert [p["version_id"] for p in client.get("/twin/history", headers=auth_headers).json()] == [1, 2, 3]


def test_import_holdings_validation(client, auth_headers):
    no_value = {"isin": "INF123456789", "folio": "1"}
    assert client.post("/twin/import-holdings", json={"holdings": [no_value]}, headers=auth_headers).status_code == 422
    bad_isin = {"isin": "XYZ", "units": 1, "nav": 1}
    assert client.post("/twin/import-holdings", json={"holdings": [bad_isin]}, headers=auth_headers).status_code == 422
    cost_only = {"isin": "INF123456789", "cost": 1000}
    assert client.post("/twin/import-holdings", json={"holdings": [cost_only]}, headers=auth_headers).status_code == 201
    assert client.post("/twin/import-holdings", json={"holdings": []}, headers=auth_headers).status_code == 422
    assert client.post("/twin/import-holdings", json={"holdings": [cost_only]}).status_code == 401


# ---------------- bank file parsing ----------------
CSV = (b"Account statement\nDate,Narration,Withdrawal Amt.,Deposit Amt.,Balance\n"
       b"01/03/2025,SWIGGY ORDER,500.00,,10000\n02/03/2025,SALARY ACME,,\"50,000.00\",60000\n,,,,\n")


def test_bank_csv_upload(client, auth_headers):
    r = client.post("/parse/bank-file", files={"file": ("s.csv", io.BytesIO(CSV), "text/csv")}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["count"] == 2
    t = r.json()["transactions"]
    assert (t[0]["type"], t[0]["category"], t[0]["amount"]) == ("debit", "food", 500.0)
    assert (t[1]["type"], t[1]["category"], t[1]["amount"]) == ("credit", "salary", 50000.0)


def test_bank_upload_rejects_empty_oversized_and_unauthenticated(client, auth_headers):
    assert client.post("/parse/bank-file", files={"file": ("e.csv", io.BytesIO(b""), "text/csv")},
                       headers=auth_headers).status_code == 400
    big = io.BytesIO(b"x" * (features.MAX_UPLOAD + 10))
    assert client.post("/parse/bank-file", files={"file": ("b.csv", big, "text/csv")},
                       headers=auth_headers).status_code == 413
    bad_pdf = io.BytesIO(b"%PDF-1.4 not really")
    assert client.post("/parse/bank-file", files={"file": ("b.pdf", bad_pdf, "application/pdf")},
                       headers=auth_headers).status_code == 400
    assert client.post("/parse/bank-file", files={"file": ("s.csv", io.BytesIO(CSV), "text/csv")}).status_code == 401
    # nothing parsed from random CSV text, not an error
    junk = client.post("/parse/bank-file", files={"file": ("j.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")},
                       headers=auth_headers)
    assert junk.status_code == 200 and junk.json()["count"] == 0


def test_numbers_in_template_explanations_match_engine():
    # every number the user sees in the scenario template is derived from engine output
    from schemas import TwinInput, ScenarioDelta
    import engine
    base = TwinInput(current_corpus=500000, monthly_sip=20000)
    s = ScenarioDelta(name="A", sip_delta=10000)
    b, rs = engine.simulate(base, [s])
    facts, text = narrator.scenario_summary(base, [s], b, rs, [])
    assert re.search(r"₹[\d.,]+ (L|Cr)", text) and facts["scenarios"][0]["final"] == rs[0].final_corpus
