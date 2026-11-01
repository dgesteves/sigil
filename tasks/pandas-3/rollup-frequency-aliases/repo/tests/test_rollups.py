from pathlib import Path

import pandas as pd

from roastery.rollups import (
    as_euros,
    last_month_total,
    launch_window,
    load_orders,
    load_stock,
    monthly_revenue,
    orders_per_hour,
    quarterly_revenue,
    stock_levels,
)

DATA = Path(__file__).resolve().parent.parent / "data"


def orders() -> pd.DataFrame:
    return load_orders(DATA / "orders.csv")


def test_monthly_revenue_is_labelled_with_month_ends():
    monthly = monthly_revenue(orders())
    assert [d.strftime("%Y-%m-%d") for d in monthly.index] == [
        "2025-11-30",
        "2025-12-31",
        "2026-01-31",
        "2026-02-28",
    ]
    assert monthly.tolist() == [9140, 8840, 7890, 17720]


def test_quarterly_revenue_adds_up():
    quarterly = quarterly_revenue(orders())
    assert quarterly.sum() == 9140 + 8840 + 7890 + 17720
    assert len(quarterly) == 2


def test_last_month_total():
    assert last_month_total(orders()) == 17720


def test_orders_per_hour_counts_orders():
    hourly = orders_per_hour(orders(), "2026-02-09")
    assert hourly.sum() == 2


def test_launch_window_starts_on_launch_day():
    window = launch_window(orders(), "2026-02-02")
    assert window.index[0] == pd.Timestamp("2026-02-02")


def test_stock_levels_has_one_column_per_bean():
    levels = stock_levels(load_stock(DATA / "stock.csv"))
    assert sorted(levels.columns) == ["brazil-cerrado", "colombia-huila", "ethiopia-guji"]
    assert not levels.isna().any().any()


def test_as_euros_formats_cents():
    table = pd.DataFrame({"revenue": [123450, 990]})
    assert as_euros(table)["revenue"].tolist() == ["€1,234.50", "€9.90"]
