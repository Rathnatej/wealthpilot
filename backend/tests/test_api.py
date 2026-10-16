

BODY = {"twin": {"current_corpus": 500000, "monthly_sip": 20000},
        "scenarios": [{"name": "A", "sip_delta": 10000}]}


def test_health_and_simulate(client):
    assert client.get("/health").json() == {"status": "ok"}
    r = client.post("/simulate", json=BODY)
    assert r.status_code == 200
    d = r.json()
    assert d["scenarios"][0]["final_corpus"] > d["baseline"]["final_corpus"]


def test_validation_rejects_bad_input(client):
    assert client.post("/simulate", json={"twin": {"years": 0}}).status_code == 422


def test_cors_allows_configured_origin_only(client):
    h = {"Access-Control-Request-Method": "POST"}
    ok = client.options("/simulate", headers={**h, "Origin": "http://localhost:3000"})
    bad = client.options("/simulate", headers={**h, "Origin": "https://evil.example"})
    assert ok.status_code == 200
    assert bad.status_code == 400


def test_ai_requires_login(client):
    assert client.post("/ai/intent", json={"query": "hi"}).status_code == 401
    assert client.post("/ai/explain", json={"query": "hi"}).status_code == 401
    assert client.post("/parse/bank", data={"text": "x"}).status_code == 401
