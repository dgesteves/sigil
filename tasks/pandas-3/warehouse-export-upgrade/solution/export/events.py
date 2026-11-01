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

# pandas 3 infers datetime64[us] (not [ns]) for these timestamps, so never derive epoch values
# from the raw integer representation: divide a timedelta by the unit you want instead.
_EPOCH = pd.Timestamp("1970-01-01", tz="UTC")
_MILLISECOND = pd.Timedelta(milliseconds=1)
_SECOND = pd.Timedelta(seconds=1)


def _epoch_ms(ts: pd.Series) -> pd.Series:
    return ((ts - _EPOCH) // _MILLISECOND).astype("int64")


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
    rows["channel"] = rows["channel"].fillna("web")
    rows["event_ms"] = _epoch_ms(rows["ts"])
    rows["hour"] = rows["ts"].dt.floor("h").dt.strftime("%Y-%m-%dT%H:00Z")
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
            "start_ms": _epoch_ms(bounds["min"]),
            "end_ms": _epoch_ms(bounds["max"]),
            "duration_s": ((bounds["max"] - bounds["min"]) // _SECOND).astype("int64"),
            "events": grouped.size(),
        }
    ).reset_index(drop=True)


def plan_summary(events: pd.DataFrame) -> pd.DataFrame:
    """One row per plan, in PLANS order, including plans that had no events (all zeros).

    Columns: plan, events, users (distinct user_id), revenue_cents.
    """
    # pandas 3 changed the groupby default to observed=True, which drops empty categories.
    grouped = events.groupby("plan", observed=False)
    summary = pd.DataFrame(
        {
            "events": grouped.size(),
            "users": grouped["user_id"].nunique(),
            "revenue_cents": grouped["amount_cents"].sum().astype("int64"),
        }
    )
    return summary.reset_index()
