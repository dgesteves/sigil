from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import sessionmaker

from helpdesk.models import Base


def make_engine(url: str = "sqlite:///helpdesk.db") -> Engine:
    engine = create_engine(url)

    # SQLite only enforces foreign keys when asked to, per connection.
    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(engine)
