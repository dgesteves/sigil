"""Nightly export of product-analytics events to the warehouse.

The warehouse loader is strict: column names, order, types and values must match what it
expects (see README.md).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

PLANS = ["free", "starter", "pro", "enterprise"]

ROW_COLUMNS = [
    "event_id",
    "event_ms",
    "hour",
    "user_id",
    "session_id",
    "plan",
    "channel",
    "event",
    "amount_cents",
]


def load_events(path: str | Path) -> pd.DataFrame:
    """Read an events CSV as produced by the collector."""
    events = pd.read_csv(
        path,
        dtype={"event_id": str, "user_id": str, "session_id": str, "channel": str, "event": str},
    )
    events["ts"] = pd.to_datetime(events["ts"], utc=True)
    events["plan"] = pd.Categorical(events["plan"], categories=PLANS)
    return events


def to_warehouse_rows(events: pd.DataFrame) -> pd.DataFrame:
    """One row per event, ordered by time, in the loader's column order.

    - event_ms: event time as integer milliseconds since the Unix epoch (UTC)
    - hour: the UTC hour the event falls in, as "YYYY-MM-DDTHH:00Z"
    - channel: events the collector could not attribute are reported as "web"
    - amount_cents: integer, 0 for events without an amount
    """
    rows = events.sort_values(["ts", "event_id"]).reset_index(drop=True)
    rows["channel"][rows["channel"].isna()] = "web"
    rows["event_ms"] = rows["ts"].view("int64") // 10**6
    rows["hour"] = rows["ts"].dt.floor("H").dt.strftime("%Y-%m-%dT%H:00Z")
    rows["amount_cents"] = rows["amount_cents"].fillna(0).astype("int64")
    return rows[ROW_COLUMNS]


def session_table(events: pd.DataFrame) -> pd.DataFrame:
    """One row per session, ordered by session_id.

    - start_ms / end_ms: first and last event time, integer epoch milliseconds (UTC)
    - duration_s: whole seconds between the first and the last event (rounded down)
    - events: number of events in the session
    """
    grouped = events.groupby("session_id")
    bounds = grouped["ts"].agg(["min", "max"])
    return pd.DataFrame(
        {
            "session_id": bounds.index,
            "start_ms": bounds["min"].astype("int64") // 10**6,
            "end_ms": bounds["max"].astype("int64") // 10**6,
            "duration_s": (bounds["max"] - bounds["min"]).astype("int64") // 10**9,
            "events": grouped.size(),
        }
    ).reset_index(drop=True)


def plan_summary(events: pd.DataFrame) -> pd.DataFrame:
    """One row per plan, in PLANS order, including plans that had no events (all zeros).

    Columns: plan, events, users (distinct user_id), revenue_cents.
    """
    grouped = events.groupby("plan")
    summary = pd.DataFrame(
        {
            "events": grouped.size(),
            "users": grouped["user_id"].nunique(),
            "revenue_cents": grouped["amount_cents"].sum().astype("int64"),
        }
    )
    return summary.reset_index()
