import pytest

from helpdesk.db import init_db, make_engine, make_sessionmaker
from helpdesk.models import Agent


@pytest.fixture
def session_factory(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'helpdesk.db'}")
    init_db(engine)
    yield make_sessionmaker(engine)
    engine.dispose()


@pytest.fixture
def agents(session_factory):
    with session_factory() as session:
        ana = Agent(name="Ana", email="ana@example.org")
        bo = Agent(name="Bo", email="bo@example.org")
        session.add_all([ana, bo])
        session.commit()
        return {"ana": ana.id, "bo": bo.id}
