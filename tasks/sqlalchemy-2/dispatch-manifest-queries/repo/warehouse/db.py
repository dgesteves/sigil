from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker

from warehouse.models import Base


def make_engine(url: str = "sqlite:///warehouse.db") -> Engine:
    return create_engine(url)


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(engine)
