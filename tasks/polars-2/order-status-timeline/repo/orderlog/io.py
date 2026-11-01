"""Lazy readers for the order event exports.

Production files are large (the events export is tens of GB a month), so everything here returns a
LazyFrame and nothing is collected until the caller decides to.
"""

import polars as pl

EVENT_SCHEMA = {
    "event_id": pl.Int64,
    "order_id": pl.Int64,
    "occurred_at": pl.String,
    "status": pl.String,
    "amount_cents": pl.Int64,
}

ORDER_SCHEMA = {
    "order_id": pl.Int64,
    "customer_id": pl.Int64,
    "region": pl.String,
}


def scan_events(path: str) -> pl.LazyFrame:
    """Events as written by the producers: one row per state change, in no particular order."""
    return pl.scan_csv(path, schema=EVENT_SCHEMA).with_columns(
        pl.col("occurred_at").str.to_datetime("%Y-%m-%dT%H:%M:%S")
    )


def scan_orders(path: str) -> pl.LazyFrame:
    return pl.scan_csv(path, schema=ORDER_SCHEMA)
