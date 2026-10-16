import uuid
from datetime import date, timedelta

import pytest

import auth
import engine


def _signup(client, password="correct-horse", name="Tester"):
    email = f"{uuid.uuid4().hex[:12]}@example.com"
    r = client.post("/auth/signup", json={"email": email, "password": password, "name": name})
    return email, r


def _auth_headers(client):
    _, r = _signup(client)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------------- auth ----------------
def test_signup_login_me(client):
    email, r = _signup(client)
    assert r.status_code == 201
    assert "password" not in r.text
    login = client.post("/auth/login", json={"email": email.upper(), "password": "correct-horse"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["email"] == email


def test_duplicate_wrong_password_and_validation(client):
    email, _ = _signup(client)
    dup = client.post("/auth/signup", json={"email": email, "password": "another-pass1"})
    assert dup.status_code == 409
    bad = client.post("/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401
    unknown = client.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever1"})
    assert unknown.status_code == 401 and unknown.json() == bad.json()
    assert client.post("/auth/signup", json={"email": "a@example.com", "password": "short"}).status_code == 422
    assert client.post("/auth/signup", json={"email": "not-an-email", "password": "longenough1"}).status_code == 422


def test_protected_routes_reject_bad_tokens(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/goals", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_google_login_creates_then_reuses_and_links(client, monkeypatch):
    sub, email = uuid.uuid4().hex, f"{uuid.uuid4().hex[:10]}@example.com"
    monkeypatch.setattr(auth, "verify_google_token", lambda t: {
        "sub": sub, "email": email, "email_verified": True, "name": "G User"})
    first = client.post("/auth/google", json={"credential": "x" * 20})
    again = client.post("/auth/google", json={"credential": "x" * 20})
    assert first.status_code == 200 and first.json()["user"]["name"] == "G User"
    assert first.json()["user"]["id"] == again.json()["user"]["id"]

    # Google-only account cannot log in with a password
    assert client.post("/auth/login", json={"email": email, "password": "guess-guess1"}).status_code == 401

    # existing password account with same verified email gets linked
    email2, r2 = _signup(client)
    monkeypatch.setattr(auth, "verify_google_token", lambda t: {
        "sub": uuid.uuid4().hex, "email": email2, "email_verified": True})
    linked = client.post("/auth/google", json={"credential": "y" * 20})
    assert linked.json()["user"]["id"] == r2.json()["user"]["id"]


def test_google_rejects_unverified_invalid_and_unconfigured(client, monkeypatch):
    monkeypatch.setattr(auth, "verify_google_token", lambda t: {
        "sub": "s", "email": "u@example.com", "email_verified": False})
    assert client.post("/auth/google", json={"credential": "z" * 20}).status_code == 401

    def boom(_):
        raise ValueError("bad token")
    monkeypatch.setattr(auth, "verify_google_token", boom)
    assert client.post("/auth/google", json={"credential": "z" * 20}).status_code == 401

    def unconfigured(_):
        raise RuntimeError("GOOGLE_CLIENT_ID not set")
    monkeypatch.setattr(auth, "verify_google_token", unconfigured)
    assert client.post("/auth/google", json={"credential": "z" * 20}).status_code == 503


def test_copilot_works_without_ai_key_via_rules(client):
    r = client.post("/ai/copilot", json={"query": "What if I raise my SIP by 5000?"},
                    headers=_auth_headers(client))
    assert r.status_code == 200 and r.json()["parsed_by"] == "rules"


# ---------------- saved twin ----------------
TWIN = {
    "monthly_income": 100000, "monthly_expenses": 50000, "monthly_sip": 20000, "annual_return": 0.12,
    "assets": [{"kind": "equity_mf", "name": "Index fund", "value": 500000},
               {"kind": "cash", "name": "Savings", "value": 100000}],
    "liabilities": [{"name": "Car loan", "principal": 200000, "interest_rate": 0.09,
                     "remaining_months": 36, "monthly_emi": 7000}],
}


def test_twin_versions_history_and_isolation(client):
    h = _auth_headers(client)
    assert client.get("/twin/latest", headers=h).json() is None
    v1 = client.post("/twin", json=TWIN, headers=h)
    assert v1.status_code == 201
    assert v1.json()["version_id"] == 1 and v1.json()["net_worth"] == 400000
    bigger = {**TWIN, "assets": TWIN["assets"] + [{"kind": "gold", "name": "Gold", "value": 100000}]}
    v2 = client.post("/twin", json=bigger, headers=h).json()
    assert v2["version_id"] == 2 and v2["net_worth"] == 500000

    latest = client.get("/twin/latest", headers=h).json()
    assert latest["version_id"] == 2 and len(latest["assets"]) == 3 and len(latest["liabilities"]) == 1
    hist = client.get("/twin/history", headers=h).json()
    assert [p["version_id"] for p in hist] == [1, 2]
    assert [p["net_worth"] for p in hist] == [400000, 500000]

    other = _auth_headers(client)
    assert client.get("/twin/latest", headers=other).json() is None
    assert client.get("/twin/history", headers=other).json() == []


def test_twin_requires_auth_and_validates(client):
    assert client.post("/twin", json=TWIN).status_code == 401
    bad = {**TWIN, "assets": [{"kind": "cash", "name": "x", "value": -5}]}
    assert client.post("/twin", json=bad, headers=_auth_headers(client)).status_code == 422


# ---------------- goals ----------------
def _goal(**kw):
    base = {"name": "House", "target_amount": 1000000,
            "target_date": str(date.today() + timedelta(days=365 * 10)),
            "inflation_rate": 0.06, "current_saved": 100000,
            "monthly_contribution": 5000, "expected_return": 0.10}
    return {**base, **kw}


def test_goal_crud_and_isolation(client):
    h = _auth_headers(client)
    created = client.post("/goals", json=_goal(), headers=h)
    assert created.status_code == 201
    g = created.json()
    assert g["inflated_target"] > 1000000 and g["years_left"] > 9.9
    assert 0 < g["progress_pct"]

    assert [x["id"] for x in client.get("/goals", headers=h).json()] == [g["id"]]
    upd = client.put(f"/goals/{g['id']}", json=_goal(name="Bigger house"), headers=h)
    assert upd.json()["name"] == "Bigger house"

    other = _auth_headers(client)
    assert client.get("/goals", headers=other).json() == []
    assert client.delete(f"/goals/{g['id']}", headers=other).status_code == 404
    assert client.put(f"/goals/{g['id']}", json=_goal(), headers=other).status_code == 404

    assert client.delete(f"/goals/{g['id']}", headers=h).status_code == 204
    assert client.get("/goals", headers=h).json() == []


def test_goal_validation(client):
    h = _auth_headers(client)
    past = _goal(target_date=str(date.today() - timedelta(days=1)))
    assert client.post("/goals", json=past, headers=h).status_code == 422
    assert client.post("/goals", json=_goal(target_amount=0), headers=h).status_code == 422
    assert client.post("/goals", json=_goal()).status_code == 401


# ---------------- goal maths ----------------
TODAY = date(2025, 1, 1)
IN_10Y = date(2035, 1, 1)


def test_goal_status_zero_rates():
    s = engine.goal_status(1_000_000, 0, 0, 10_000, 0, IN_10Y, TODAY)
    assert s["projected_value"] == pytest.approx(1_200_000, rel=0.01)
    assert s["on_track"] is True and s["shortfall"] == 0


def test_goal_required_contribution_hits_target():
    s = engine.goal_status(2_000_000, 0.06, 100_000, 0, 0.10, IN_10Y, TODAY)
    assert s["on_track"] is False and s["shortfall"] > 0
    again = engine.goal_status(2_000_000, 0.06, 100_000, s["required_monthly_contribution"], 0.10, IN_10Y, TODAY)
    assert again["projected_value"] == pytest.approx(again["inflated_target"], rel=0.002)


def test_goal_status_matches_month_by_month_projection():
    from schemas import TwinInput
    s = engine.goal_status(1_000_000, 0.0, 50_000, 8_000, 0.12, IN_10Y, TODAY)
    sim = engine.project(TwinInput(current_corpus=50_000, monthly_sip=8_000, annual_return=0.12, years=10))
    assert s["projected_value"] == pytest.approx(sim.final_corpus, rel=0.001)
