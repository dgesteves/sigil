"""SQLite access for the orders API.

Every request gets its own connection from `get_db`. Connections are opened with
`check_same_thread=False` because FastAPI may enter and exit a sync dependency on different
worker threads than the one running the endpoint.
"""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, Request, status

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    customer   TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'cancelled')),
    created_at TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
    order_id INTEGER NOT NULL REFERENCES orders (id),
    sku      TEXT    NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);
"""


@dataclass(frozen=True)
class DatabaseConfig:
    path: Path
    # Tests pass a sqlite3.Connection subclass here to simulate driver failures.
    connection_class: type[sqlite3.Connection] = sqlite3.Connection


def open_connection(config: DatabaseConfig) -> sqlite3.Connection:
    conn = sqlite3.connect(
        config.path, factory=config.connection_class, check_same_thread=False
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(config: DatabaseConfig) -> None:
    conn = sqlite3.connect(config.path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


SAVE_FAILED = "Could not save your changes, please try again"


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """One connection per request; commit if the endpoint succeeded, roll back if it raised.

    The code after `yield` runs after the response is sent unless the dependency is declared with
    `Depends(get_db, scope="function")` (see `Db` in app/routers/orders.py). With that scope it runs
    when the endpoint returns, so the commit happens before the status line goes out and a failed
    commit can still become a 503.
    """
    conn = open_connection(request.app.state.db)
    try:
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        try:
            conn.commit()
        except sqlite3.Error as exc:
            conn.rollback()
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, SAVE_FAILED) from exc
    finally:
        conn.close()
