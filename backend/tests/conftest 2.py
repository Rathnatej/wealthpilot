import os

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test.db"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ.pop("GEMINI_API_KEY", None)
