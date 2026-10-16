from datetime import date

import credit
from credit import CardIn, CreditRequest, due_reminders, next_due_date, what_if


def card(name="A", limit=100000, balance=60000, apr=42.0, **kw):
    return CardIn(name=name, limit=limit, balance=balance, apr=apr, **kw)


# ---------- what-if ----------
def test_what_if_zero_changes_nothing():
    r = what_if(CreditRequest(cards=[card()], monthly_card_budget=10000), 0)
    assert r["utilization_after_pct"] == r["utilization_before_pct"] == 60.0
    assert r["interest_saved"] == 0 and r["allocation"] == []


def test_what_if_pays_highest_apr_first_and_crosses_threshold():
    req = CreditRequest(cards=[card("Low", 100000, 50000, 20), card("High", 100000, 50000, 48)],
                        monthly_card_budget=15000)
    r = what_if(req, 30000)
    assert r["allocation"] == [{"card": "High", "paid": 30000.0}]
    assert r["utilization_before_pct"] == 50.0 and r["utilization_after_pct"] == 35.0
    assert not r["under_30_after"]
    r2 = what_if(req, 40000)
    assert r2["utilization_after_pct"] == 30.0 and r2["under_30_after"]
    assert r2["interest_saved"] > 0 and r2["months_after"] <= r2["months_before"]


def test_what_if_caps_at_total_balance():
    r = what_if(CreditRequest(cards=[card(balance=5000)]), 100000)
    assert r["applied"] == 5000.0 and r["unused"] == 95000.0 and r["utilization_after_pct"] == 0.0


def test_what_if_endpoint(client):
    body = {"request": {"cards": [{"name": "X", "limit": 50000, "balance": 40000}]}, "extra_payment": 10000}
    r = client.post("/credit/what-if", json=body)
    assert r.status_code == 200 and r.json()["utilization_after_pct"] == 60.0
    body["extra_payment"] = -1
    assert client.post("/credit/what-if", json=body).status_code == 422


# ---------- due dates ----------
def test_next_due_date_edges():
    assert next_due_date(15, date(2026, 10, 10)) == date(2026, 10, 15)
    assert next_due_date(15, date(2026, 10, 15)) == date(2026, 10, 15)
    assert next_due_date(5, date(2026, 10, 10)) == date(2026, 11, 5)
    assert next_due_date(5, date(2026, 12, 10)) == date(2027, 1, 5)
    assert next_due_date(31, date(2026, 2, 10)) == date(2026, 2, 28)  # short month clamps
    assert next_due_date(31, date(2026, 2, 28)) == date(2026, 2, 28)


def test_due_reminders_window_and_filters():
    today = date(2026, 10, 10)
    cards = [
        {"name": "Soon", "balance": 20000, "limit": 100000, "apr": 42, "due_day": 12},
        {"name": "Today", "balance": 20000, "limit": 100000, "apr": 42, "due_day": 10},
        {"name": "Far", "balance": 20000, "limit": 100000, "apr": 42, "due_day": 25},
        {"name": "Paid off", "balance": 0, "limit": 100000, "apr": 42, "due_day": 11},
        {"name": "No day", "balance": 20000, "limit": 100000, "apr": 42},
    ]
    out = due_reminders(cards, today)
    assert [o["name"] for o in out] == ["Today", "Soon"]
    assert out[0]["days"] == 0 and out[1]["days"] == 2
    assert out[0]["minimum_due"] == 1000.0  # 5% of 20,000


# ---------- snapshots ----------
def _payload(score=640, balance=60000):
    return {"score": score, "monthly_income": 80000,
            "cards": [{"name": "HDFC", "limit": 100000, "balance": balance, "apr": 42, "due_day": 15}]}


def test_snapshots_require_login(client):
    assert client.post("/credit/snapshots", json=_payload()).status_code == 401
    assert client.get("/credit/snapshots").status_code == 401


def test_snapshot_save_list_latest_delete_and_isolation(client, auth_headers):
    a = client.post("/credit/snapshots", json=_payload(640, 60000), headers=auth_headers)
    assert a.status_code == 201 and a.json()["utilization_pct"] == 60.0
    b = client.post("/credit/snapshots", json=_payload(670, 30000), headers=auth_headers)
    rows = client.get("/credit/snapshots", headers=auth_headers).json()
    assert [r["score"] for r in rows] == [640, 670]
    latest = client.get("/credit/snapshots/latest", headers=auth_headers).json()
    assert latest["score"] == 670 and latest["inputs"]["cards"][0]["due_day"] == 15

    # another user cannot see or delete them
    other = client.post("/auth/signup", json={"email": "other-credit@example.com", "password": "correct-horse"})
    oh = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get("/credit/snapshots", headers=oh).json() == []
    assert client.delete(f"/credit/snapshots/{a.json()['id']}", headers=oh).status_code == 404

    assert client.delete(f"/credit/snapshots/{a.json()['id']}", headers=auth_headers).status_code == 204
    assert len(client.get("/credit/snapshots", headers=auth_headers).json()) == 1
    assert b.status_code == 201


def test_empty_latest_is_null(client, auth_headers):
    assert client.get("/credit/snapshots/latest", headers=auth_headers).json() is None


# ---------- reminders ----------
def test_reminders_disabled_without_secret(client):
    assert client.post("/credit/reminders/send").status_code == 503


def test_reminders_send_only_to_opted_in_with_due_cards(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s3cret-value")
    sent = []
    monkeypatch.setattr(credit.mailer, "is_configured", lambda: True)
    monkeypatch.setattr(credit.mailer, "send_email", lambda to, subj, body: sent.append((to, subj, body)))

    assert client.post("/credit/reminders/send").status_code == 401
    assert client.post("/credit/reminders/send", headers={"X-Cron-Secret": "wrong"}).status_code == 401

    def make(email, opt_in):
        tok = client.post("/auth/signup", json={"email": email, "password": "correct-horse"}).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        client.put("/me/preferences", json={"email_alerts": opt_in}, headers=h)
        body = _payload()
        body["cards"][0]["due_day"] = date.today().day  # due today
        client.post("/credit/snapshots", json=body, headers=h)

    make("rem-yes@example.com", True)
    make("rem-no@example.com", False)

    r = client.post("/credit/reminders/send", headers={"X-Cron-Secret": "s3cret-value"})
    assert r.status_code == 200 and r.json()["failed"] == 0
    recipients = [s[0] for s in sent]
    assert "rem-yes@example.com" in recipients and "rem-no@example.com" not in recipients
    body = next(s[2] for s in sent if s[0] == "rem-yes@example.com")
    assert "HDFC" in body and "today" in body and "not financial advice" in body
