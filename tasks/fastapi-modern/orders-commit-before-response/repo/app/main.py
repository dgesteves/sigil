import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.db import DatabaseConfig, init_db
from app.routers import orders


def create_app(
    database: str | Path,
    *,
    connection_class: type[sqlite3.Connection] = sqlite3.Connection,
) -> FastAPI:
    config = DatabaseConfig(path=Path(database), connection_class=connection_class)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_db(config)
        yield

    app = FastAPI(title="Orders API", version="3.4.0", lifespan=lifespan)
    app.state.db = config
    app.include_router(orders.router)
    return app
