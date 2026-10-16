import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./wealthpilot.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

connect_args = {}
if DATABASE_URL.startswith("postgresql+asyncpg"):
    # asyncpg rejects libpq params like sslmode/channel_binding; strip them and use ssl=True
    parts = urlsplit(DATABASE_URL)
    params = dict(parse_qsl(parts.query))
    sslmode = params.pop("sslmode", None)
    params.pop("channel_binding", None)
    DATABASE_URL = urlunsplit(parts._replace(query=urlencode(params)))
    if sslmode and sslmode != "disable":
        connect_args["ssl"] = True

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_session():
    async with SessionLocal() as session:
        yield session


def _add_missing_columns(sync_conn):
    """Tiny migration step: add columns that models gained after a table was first created."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    quote = sync_conn.dialect.identifier_preparer.quote
    for table in Base.metadata.sorted_tables:
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                ddl = col.type.compile(dialect=sync_conn.dialect)
                sync_conn.execute(text(
                    f"ALTER TABLE {quote(table.name)} ADD COLUMN {quote(col.name)} {ddl}"))


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
