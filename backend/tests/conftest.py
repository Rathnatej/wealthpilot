import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com"
os.environ.pop("GEMINI_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from main import app
    with TestClient(app) as c:  # one app/event loop for the whole session
        yield c
