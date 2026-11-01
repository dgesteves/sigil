import pytest_asyncio

from helpdesk.db import init_db, make_engine, make_sessionmaker
from helpdesk.models import Agent


@pytest_asyncio.fixture
async def session_factory(tmp_path):
    engine = make_engine(f"sqlite+aiosqlite:///{tmp_path / 'helpdesk.db'}")
    await init_db(engine)
    yield make_sessionmaker(engine)
    await engine.dispose()


@pytest_asyncio.fixture
async def agents(session_factory):
    async with session_factory() as session:
        ana = Agent(name="Ana", email="ana@example.org")
        bo = Agent(name="Bo", email="bo@example.org")
        session.add_all([ana, bo])
        await session.commit()
        return {"ana": ana.id, "bo": bo.id}
