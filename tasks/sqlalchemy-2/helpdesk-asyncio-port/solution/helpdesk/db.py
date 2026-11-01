from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from helpdesk.models import Base


def make_engine(url: str = "sqlite+aiosqlite:///helpdesk.db") -> AsyncEngine:
    engine = create_async_engine(url)

    # SQLite only enforces foreign keys when asked to, per connection. Pool events are synchronous,
    # so they attach to the sync engine the AsyncEngine wraps.
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


async def init_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker:
    # Objects are handed to synchronous serializers after commit, sometimes after the session is
    # closed, so commit must not expire them.
    return async_sessionmaker(engine, expire_on_commit=False)
