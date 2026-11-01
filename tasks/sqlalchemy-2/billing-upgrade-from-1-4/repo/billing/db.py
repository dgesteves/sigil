from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from billing.models import Base


def make_engine(url="sqlite:///billing.db"):
    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def init_db(engine):
    Base.metadata.create_all(bind=engine)


def make_sessionmaker(engine):
    return sessionmaker(bind=engine)
