"""SQLite access for the orders API.

Every request gets its own connection from `get_db`. Connections are opened with
`check_same_thread=False` because FastAPI may enter and exit a sync dependency on different
worker threads than the one running the endpoint.
"""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from fastapi import Request

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


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """One connection per request; commit if the endpoint succeeded, roll back if it raised."""
    conn = open_connection(request.app.state.db)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
