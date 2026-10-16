import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("CRON_SECRET", None)

import uuid  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from main import app
    with TestClient(app) as c:  # one app/event loop for the whole session
        yield c


@pytest.fixture()
def auth_user(client):
    """A fresh signed-up user: (email, headers)."""
    email = f"{uuid.uuid4().hex[:12]}@example.com"
    r = client.post("/auth/signup", json={"email": email, "password": "correct-horse", "name": "T"})
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def auth_headers(auth_user):
    return auth_user[1]
