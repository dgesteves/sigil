"""Hidden checks for order_timeline and customer_spend against a plain-Python reference."""

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import polars as pl
import pytest

from orderlog.io import scan_events, scan_orders
from orderlog.timeline import customer_spend, order_timeline

FIXTURES = Path(__file__).parent / "order_timeline_fixtures"
EVENTS = str(FIXTURES / "events.csv")
ORDERS = str(FIXTURES / "orders.csv")


def _load():
    with open(ORDERS, newline="") as f:
        orders = {int(r["order_id"]): r for r in csv.DictReader(f)}
    with open(EVENTS, newline="") as f:
        events = []
        for r in csv.DictReader(f):
            events.append(
                {
                    "event_id": int(r["event_id"]),
                    "order_id": int(r["order_id"]),
                    "occurred_at": datetime.fromisoformat(r["occurred_at"]),
                    "status": r["status"],
                    "amount_cents": int(r["amount_cents"]) if r["amount_cents"] else None,
                }
            )
    return orders, [e for e in events if e["order_id"] in orders]


def _key(e):
    return (e["occurred_at"], e["event_id"])


def expected_timeline():
    orders, events = _load()
    by_order = defaultdict(list)
    for e in events:
        by_order[e["order_id"]].append(e)
    rows = []
    for order_id in sorted(by_order):
        evs = sorted(by_order[order_id], key=_key)
        o = orders[order_id]
        rows.append(
            {
                "order_id": order_id,
                "customer_id": int(o["customer_id"]),
                "region": o["region"],
                "n_events": len(evs),
                "first_event_at": evs[0]["occurred_at"],
                "last_event_at": evs[-1]["occurred_at"],
                "current_status": evs[-1]["status"],
                "previous_status": evs[-2]["status"] if len(evs) > 1 else None,
            }
        )
    return rows


def expected_spend():
    orders, events = _load()
    money = [e for e in events if e["status"] in ("payment_captured", "refund_issued")]
    for e in money:
        e["customer_id"] = int(orders[e["order_id"]]["customer_id"])
    money.sort(key=lambda e: (e["customer_id"], e["occurred_at"], e["event_id"]))
    rows, totals = [], defaultdict(int)
    for e in money:
        signed = e["amount_cents"] if e["status"] == "payment_captured" else -e["amount_cents"]
        totals[e["customer_id"]] += signed
        rows.append(
            {
                "customer_id": e["customer_id"],
                "order_id": e["order_id"],
                "event_id": e["event_id"],
                "occurred_at": e["occurred_at"],
                "amount_cents": signed,
                "spend_to_date_cents": totals[e["customer_id"]],
            }
        )
    return rows


def _collect(lf, columns):
    assert isinstance(lf, pl.LazyFrame), "expected a LazyFrame"
    df = lf.collect()
    missing = [c for c in columns if c not in df.columns]
    assert not missing, f"missing columns: {missing}"
    return df.select(columns).to_dicts()


TIMELINE_COLUMNS = [
    "order_id",
    "customer_id",
    "region",
    "n_events",
    "first_event_at",
    "last_event_at",
    "current_status",
    "previous_status",
]
SPEND_COLUMNS = [
    "customer_id",
    "order_id",
    "event_id",
    "occurred_at",
    "amount_cents",
    "spend_to_date_cents",
]


@pytest.fixture(scope="module")
def timeline():
    return _collect(order_timeline(scan_events(EVENTS), scan_orders(ORDERS)), TIMELINE_COLUMNS)


@pytest.fixture(scope="module")
def spend():
    return _collect(customer_spend(scan_events(EVENTS), scan_orders(ORDERS)), SPEND_COLUMNS)


def test_timeline_has_one_row_per_known_order_sorted(timeline):
    expected = expected_timeline()
    assert [r["order_id"] for r in timeline] == [r["order_id"] for r in expected]


def test_timeline_ignores_purged_orders(timeline):
    assert all(r["order_id"] < 60_000 for r in timeline)


def test_timeline_counts_and_bounds(timeline):
    expected = {r["order_id"]: r for r in expected_timeline()}
    for row in timeline:
        exp = expected[row["order_id"]]
        for col in ("customer_id", "region", "n_events", "first_event_at", "last_event_at"):
            assert row[col] == exp[col], (row["order_id"], col)


def test_current_status_is_the_latest_event(timeline):
    expected = {r["order_id"]: r for r in expected_timeline()}
    wrong = [r["order_id"] for r in timeline if r["current_status"] != expected[r["order_id"]]["current_status"]]
    assert wrong == [], f"{len(wrong)} orders with the wrong current_status, e.g. {wrong[:5]}"


def test_previous_status_is_the_event_before_the_latest(timeline):
    expected = {r["order_id"]: r for r in expected_timeline()}
    wrong = [
        r["order_id"] for r in timeline if r["previous_status"] != expected[r["order_id"]]["previous_status"]
    ]
    assert wrong == [], f"{len(wrong)} orders with the wrong previous_status, e.g. {wrong[:5]}"


def test_spend_rows_and_order(spend):
    expected = expected_spend()
    assert [(r["customer_id"], r["event_id"]) for r in spend] == [
        (r["customer_id"], r["event_id"]) for r in expected
    ]


def test_spend_signed_amounts(spend):
    expected = {r["event_id"]: r for r in expected_spend()}
    for row in spend:
        assert row["amount_cents"] == expected[row["event_id"]]["amount_cents"], row["event_id"]
        assert row["order_id"] == expected[row["event_id"]]["order_id"]
        assert row["occurred_at"] == expected[row["event_id"]]["occurred_at"]


def test_spend_running_total(spend):
    expected = {r["event_id"]: r for r in expected_spend()}
    wrong = [r["event_id"] for r in spend if r["spend_to_date_cents"] != expected[r["event_id"]]["spend_to_date_cents"]]
    assert wrong == [], f"{len(wrong)} payment rows with the wrong running total, e.g. {wrong[:5]}"


def test_results_are_stable_across_engines():
    events, orders = scan_events(EVENTS), scan_orders(ORDERS)
    lazy = order_timeline(events, orders)
    assert lazy.collect(engine="streaming").equals(lazy.collect(engine="in-memory"))
    lazy = customer_spend(events, orders)
    assert lazy.collect(engine="streaming").equals(lazy.collect(engine="in-memory"))
