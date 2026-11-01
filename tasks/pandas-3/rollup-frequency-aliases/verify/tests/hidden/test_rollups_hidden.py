# Every rollup must produce exactly what it produced on pandas 2.3.3 for the sample exports:
# the same labels (index values), in the same order, with the same values.
import json
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
    yearly_revenue,
)

HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "data"
EXPECTED = json.loads((HERE / "expected_rollups_pandas_2_3.json").read_text(encoding="utf-8"))


def pairs(series: pd.Series) -> list[list]:
    return [[str(label), value.item() if hasattr(value, "item") else value] for label, value in series.items()]


def orders() -> pd.DataFrame:
    return load_orders(DATA / "orders.csv")


def test_orders_per_hour_fills_quiet_hours_with_zero():
    assert pairs(orders_per_hour(orders(), "2026-02-09")) == EXPECTED["orders_per_hour_2026_02_09"]
    assert pairs(orders_per_hour(orders(), "2025-11-03")) == EXPECTED["orders_per_hour_2025_11_03"]


def test_monthly_quarterly_and_yearly_labels_and_values():
    assert pairs(monthly_revenue(orders())) == EXPECTED["monthly"]
    assert pairs(quarterly_revenue(orders())) == EXPECTED["quarterly"]
    assert pairs(yearly_revenue(orders())) == EXPECTED["yearly"]


def test_last_month_total():
    assert last_month_total(orders()) == EXPECTED["last_month_total"]
    assert isinstance(last_month_total(orders()), int)


def test_launch_window_is_seven_calendar_days():
    assert pairs(launch_window(orders(), "2026-02-02")) == EXPECTED["launch_2026_02_02"]
    assert pairs(launch_window(orders(), "2026-02-03")) == EXPECTED["launch_2026_02_03"]
    assert pairs(launch_window(orders(), "2025-12-24")) == EXPECTED["launch_2025_12_24"]


def test_stock_levels_carry_the_last_count_forward():
    levels = stock_levels(load_stock(DATA / "stock.csv"))
    expected = EXPECTED["stock_levels"]
    assert [str(label) for label in levels.index] == expected["index"]
    assert list(levels.columns) == expected["columns"]
    assert levels.to_numpy().tolist() == expected["values"]
    assert levels.index.name == expected["index_name"]
    assert levels.columns.name == expected["columns_name"]


def test_as_euros_formats_each_cell():
    formatted = as_euros(monthly_revenue(orders()).to_frame())
    expected = EXPECTED["as_euros_monthly"]
    assert [str(label) for label in formatted.index] == expected["index"]
    assert formatted["total_cents"].tolist() == expected["values"]
