import datetime as dt
import uuid

import pytest

import entitlements
import secure_store
import voice


@pytest.fixture(autouse=True)
def voice_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key-never-returned")
    monkeypatch.setattr(voice, "_mint_token", lambda model, secs: "auth_tokens/ephemeral-test")
    monkeypatch.setattr(voice, "_generate_summary", lambda t: {
        "summary": "Talked about the emergency fund.", "key_advice": ["Save a little each month"],
        "action_items": ["Set up a standing transfer"]})
    for k in ("VOICE_ENABLED", "VOICE_PAID_ONLY", "VOICE_PRO_EMAILS", "VOICE_FREE_DAILY_MINUTES",
              "VOICE_TOKEN_RATE_LIMIT"):
        monkeypatch.delenv(k, raising=False)
    entitlements.reset_rate_limits()


def _second_user(client):
    email = f"{uuid.uuid4().hex[:12]}@example.com"
    r = client.post("/auth/signup", json={"email": email, "password": "correct-horse", "name": "B"})
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _consent(client, h, save=False):
    return client.post("/voice/consent", json={"save_history": save}, headers=h)


def _start(client, h):
    return client.post("/voice/session", json={}, headers=h)


# ---------------------------------------------------------------- config / gate
def test_config_requires_auth(client):
    assert client.get("/voice/config").status_code == 401


def test_config_defaults(client, auth_headers):
    d = client.get("/voice/config", headers=auth_headers).json()
    assert d["allowed"] and d["reason"] is None and d["consented"] is False
    assert "Sulafat" in d["voices"] and d["voice"] == "Sulafat"
    assert d["usage"]["daily_left"] == 15


def test_flag_disabled(client, auth_headers, monkeypatch):
    _consent(client, auth_headers)
    monkeypatch.setenv("VOICE_ENABLED", "false")
    assert client.get("/voice/config", headers=auth_headers).json()["reason"] == "disabled"
    r = _start(client, auth_headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "disabled"


def test_paid_gate_and_pro_user(client, auth_user, monkeypatch):
    email, h = auth_user
    _consent(client, h)
    monkeypatch.setenv("VOICE_PAID_ONLY", "true")
    r = _start(client, h)
    assert r.status_code == 402 and r.json()["detail"]["code"] == "upgrade_required"
    assert client.get("/voice/config", headers=h).json()["reason"] == "upgrade_required"
    monkeypatch.setenv("VOICE_PRO_EMAILS", email.upper())
    assert _start(client, h).status_code == 200


# ---------------------------------------------------------------- token endpoint
def test_session_requires_auth_and_consent(client, auth_headers):
    assert client.post("/voice/session", json={}).status_code == 401
    r = _start(client, auth_headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"


def test_session_returns_token_not_api_key(client, auth_headers):
    _consent(client, auth_headers)
    r = _start(client, auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["token"] == "auth_tokens/ephemeral-test" and d["model"] == "gemini-3.8-live"
    assert "fake-key-never-returned" not in r.text
    assert d["voice"] == "Sulafat" and d["max_session_seconds"] <= 15 * 60  # capped by daily allowance
    names = {f["name"] for f in d["tools"][0]["functionDeclarations"]}
    assert {"get_financial_overview", "get_goals", "upsert_savings_goal"} <= names
    assert "not a licensed" in d["system_instruction"].lower() or "not professional" in d["system_instruction"].lower()


def test_unknown_voice_falls_back(client, auth_headers):
    _consent(client, auth_headers)
    r = client.post("/voice/session", json={"voice": "Nope"}, headers=auth_headers)
    assert r.json()["voice"] == "Sulafat"
    assert client.post("/voice/consent", json={"voice": "Nope"}, headers=auth_headers).status_code == 422


def test_unavailable_without_api_key(client, auth_headers, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    _consent(client, auth_headers)
    r = _start(client, auth_headers)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "unavailable"


def test_mint_failure_is_calm(client, auth_headers, monkeypatch):
    def boom(model, secs):
        raise RuntimeError("secret internals")
    monkeypatch.setattr(voice, "_mint_token", boom)
    _consent(client, auth_headers)
    r = _start(client, auth_headers)
    assert r.status_code == 503 and "secret internals" not in r.text


def test_rate_limit(client, auth_headers, monkeypatch):
    monkeypatch.setenv("VOICE_TOKEN_RATE_LIMIT", "2")
    _consent(client, auth_headers)
    assert _start(client, auth_headers).status_code == 200
    assert _start(client, auth_headers).status_code == 200
    r = _start(client, auth_headers)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "rate_limited"


def test_free_limit_and_pro_bypass(client, auth_user, monkeypatch):
    email, h = auth_user
    _consent(client, h)
    monkeypatch.setenv("VOICE_FREE_DAILY_MINUTES", "0")
    r = _start(client, h)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "limit_reached"
    monkeypatch.setenv("VOICE_PRO_EMAILS", email)
    assert _start(client, h).status_code == 200


# ---------------------------------------------------------------- end / history / privacy
def test_end_without_history_stores_nothing(client, auth_headers):
    _consent(client, auth_headers, save=False)
    sid = _start(client, auth_headers).json()["session_id"]
    r = client.post(f"/voice/session/{sid}/end", headers=auth_headers, json={
        "language": "hi", "transcript": [{"role": "user", "text": "namaste"}]})
    assert r.status_code == 200 and r.json()["summary"] is None
    d = client.get(f"/voice/sessions/{sid}", headers=auth_headers).json()
    assert d["transcript"] == [] and d["has_transcript"] is False and d["language"] == "hi"


def test_end_is_idempotent_and_server_timed(client, auth_headers):
    _consent(client, auth_headers)
    sid = _start(client, auth_headers).json()["session_id"]
    a = client.post(f"/voice/session/{sid}/end", headers=auth_headers, json={}).json()
    b = client.post(f"/voice/session/{sid}/end", headers=auth_headers, json={}).json()
    assert a["duration_seconds"] <= 5 and b["duration_seconds"] == a["duration_seconds"]


def test_history_memory_delete_and_isolation(client, auth_headers):
    _consent(client, auth_headers, save=True)
    sid = _start(client, auth_headers).json()["session_id"]
    turns = [{"role": "user", "text": "I want an emergency fund"}, {"role": "assistant", "text": "Lovely."}]
    r = client.post(f"/voice/session/{sid}/end", headers=auth_headers,
                    json={"language": "en", "transcript": turns})
    assert r.json()["summary"]["summary"].startswith("Talked about")

    lst = client.get("/voice/sessions", headers=auth_headers).json()
    assert len(lst) == 1 and lst[0]["summary"]["action_items"] == ["Set up a standing transfer"]
    assert client.get(f"/voice/sessions/{sid}", headers=auth_headers).json()["transcript"] == turns

    # memory feeds the next session's prompt
    nxt = _start(client, auth_headers).json()
    assert "Talked about the emergency fund." in nxt["system_instruction"]

    # another user can't see or delete it
    _, other = _second_user(client)
    assert client.get(f"/voice/sessions/{sid}", headers=other).status_code == 404
    assert client.delete(f"/voice/sessions/{sid}", headers=other).status_code == 404
    assert client.get("/voice/sessions", headers=other).json() == []

    assert client.delete(f"/voice/sessions/{sid}", headers=auth_headers).status_code == 204
    assert client.get(f"/voice/sessions/{sid}", headers=auth_headers).status_code == 404


def test_delete_all_withdraws_consent(client, auth_headers):
    _consent(client, auth_headers, save=True)
    sid = _start(client, auth_headers).json()["session_id"]
    client.post(f"/voice/session/{sid}/end", headers=auth_headers,
                json={"transcript": [{"role": "user", "text": "hi"}]})
    assert client.delete("/voice/data", headers=auth_headers).status_code == 204
    assert client.get("/voice/sessions", headers=auth_headers).json() == []
    assert client.get("/voice/config", headers=auth_headers).json()["consented"] is False
    assert _start(client, auth_headers).status_code == 403


def test_encryption_roundtrip_and_wrong_key(monkeypatch):
    blob = secure_store.encrypt_json([{"role": "user", "text": "secret salary"}])
    assert "secret salary" not in blob
    assert secure_store.decrypt_json(blob)[0]["text"] == "secret salary"
    monkeypatch.setenv("JWT_SECRET", "a-completely-different-secret-value-xyz")
    assert secure_store.decrypt_json(blob) is None  # unreadable, doesn't crash


# ---------------------------------------------------------------- tools
def _tool(client, h, sid, name, args=None):
    return client.post("/voice/tool", headers=h, json={"session_id": sid, "name": name, "args": args or {}})


def _session(client, h):
    _consent(client, h)
    return _start(client, h).json()["session_id"]


def test_tools_require_auth_and_ownership(client, auth_headers):
    sid = _session(client, auth_headers)
    assert client.post("/voice/tool", json={"session_id": sid, "name": "get_goals"}).status_code == 401
    _, other = _second_user(client)
    assert _tool(client, other, sid, "get_goals").status_code == 404  # not their session


def test_tool_on_ended_session_and_unknown_tool(client, auth_headers):
    sid = _session(client, auth_headers)
    assert _tool(client, auth_headers, sid, "drop_database").json()["result"] == {"error": "unknown_tool"}
    client.post(f"/voice/session/{sid}/end", headers=auth_headers, json={})
    assert _tool(client, auth_headers, sid, "get_goals").status_code == 409


def test_financial_overview(client, auth_headers):
    sid = _session(client, auth_headers)
    assert _tool(client, auth_headers, sid, "get_financial_overview").json()["result"]["has_data"] is False
    client.post("/twin", headers=auth_headers, json={
        "monthly_income": 100000, "monthly_expenses": 40000, "monthly_sip": 10000, "annual_return": 0.12,
        "assets": [{"kind": "cash", "name": "Savings", "value": 120000}],
        "liabilities": [{"name": "Car", "principal": 300000, "interest_rate": 0.09,
                         "remaining_months": 36, "monthly_emi": 10000}]})
    r = _tool(client, auth_headers, sid, "get_financial_overview").json()["result"]
    assert r["has_data"] and r["monthly_income"] == 100000 and r["emergency_fund_months"] == 3.0
    assert r["savings_rate_pct"] == 60.0 and r["monthly_surplus_after_everything"] == 40000
    alerts = _tool(client, auth_headers, sid, "get_alerts").json()["result"]["alerts"]
    assert isinstance(alerts, list)


def test_goal_tool_needs_confirmation_and_is_scoped(client, auth_headers):
    sid = _session(client, auth_headers)
    future = (dt.date.today() + dt.timedelta(days=720)).isoformat()
    args = {"name": "Emergency fund", "target_amount": 300000, "target_date": future,
            "monthly_contribution": 10000}

    r = _tool(client, auth_headers, sid, "upsert_savings_goal", {**args, "user_confirmed": False}).json()["result"]
    assert r["status"] == "not_saved"
    assert client.get("/goals", headers=auth_headers).json() == []

    r = _tool(client, auth_headers, sid, "upsert_savings_goal", {**args, "user_confirmed": True}).json()["result"]
    assert r["status"] == "saved" and r["action"] == "created"
    r = _tool(client, auth_headers, sid, "upsert_savings_goal",
              {**args, "target_amount": 400000, "user_confirmed": True}).json()["result"]
    assert r["action"] == "updated"
    goals = client.get("/goals", headers=auth_headers).json()
    assert len(goals) == 1 and goals[0]["target_amount"] == 400000

    # string "true" from a confused model must not count as confirmation
    r = _tool(client, auth_headers, sid, "upsert_savings_goal",
              {**args, "name": "Other", "user_confirmed": "true"}).json()["result"]
    assert r["status"] == "not_saved"

    # invalid date -> calm error, nothing saved
    r = _tool(client, auth_headers, sid, "upsert_savings_goal",
              {**args, "name": "Past", "target_date": "2020-01-01", "user_confirmed": True}).json()["result"]
    assert r["status"] == "not_saved" and len(client.get("/goals", headers=auth_headers).json()) == 1

    # another user's tools never see this goal
    _, other = _second_user(client)
    osid = _session(client, other)
    assert _tool(client, other, osid, "get_goals").json()["result"]["count"] == 0
    assert _tool(client, auth_headers, sid, "get_goals").json()["result"]["count"] == 1


def test_credit_snapshot_tool(client, auth_headers):
    sid = _session(client, auth_headers)
    assert _tool(client, auth_headers, sid, "get_credit_snapshot").json()["result"]["has_data"] is False
