from datetime import datetime

import polars as pl

from orderlog.io import scan_events, scan_orders


def test_scan_events_parses_timestamps():
    events = scan_events("data/sample/events.csv").collect()
    assert events.schema["occurred_at"] == pl.Datetime("us")
    assert events.height == 9
    row = events.filter(pl.col("event_id") == 14).row(0, named=True)
    assert row["occurred_at"] == datetime(2026, 9, 1, 8, 5)
    assert row["amount_cents"] == 4999


def test_non_money_events_have_no_amount():
    events = scan_events("data/sample/events.csv").collect()
    assert events.filter(pl.col("status") == "created")["amount_cents"].null_count() == 3


def test_scan_orders():
    orders = scan_orders("data/sample/orders.csv").collect()
    assert orders["order_id"].to_list() == [1001, 1002, 1003]
