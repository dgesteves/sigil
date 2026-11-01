"""Rollups for the roastery's weekly ops review.

Every function returns a pandas object that the review notebook charts as-is, so labels
(index values) matter as much as the numbers.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_orders(path: str | Path) -> pd.DataFrame:
    """Orders export: order_id, placed_at (local time), total_cents."""
    return pd.read_csv(path, parse_dates=["placed_at"], infer_datetime_format=True)


def load_stock(path: str | Path) -> pd.DataFrame:
    """Stocktake export: taken_on, bean, kg. Only beans that were counted that day appear."""
    return pd.read_csv(path, parse_dates=["taken_on"])


def orders_per_hour(orders: pd.DataFrame, day: str) -> pd.Series:
    """Orders per clock hour on one day, from the first to the last hour with an order.

    Hours in between without orders are included with a count of 0.
    """
    placed = orders.set_index("placed_at").sort_index().loc[day]
    return placed["order_id"].resample("H").count()


def monthly_revenue(orders: pd.DataFrame) -> pd.Series:
    """Revenue per calendar month, labelled with the month's last day."""
    return orders.set_index("placed_at")["total_cents"].resample("M").sum()


def quarterly_revenue(orders: pd.DataFrame) -> pd.Series:
    """Revenue per calendar quarter, labelled with the quarter's last day."""
    return orders.set_index("placed_at")["total_cents"].resample("Q").sum()


def yearly_revenue(orders: pd.DataFrame) -> pd.Series:
    """Revenue per calendar year, labelled with 31 December."""
    return orders.set_index("placed_at")["total_cents"].resample("A").sum()


def last_month_total(orders: pd.DataFrame) -> int:
    """Revenue of the most recent month in the export, in cents."""
    monthly = monthly_revenue(orders)
    return int(monthly[-1])


def launch_window(orders: pd.DataFrame, start: str) -> pd.Series:
    """Daily revenue for the first 7 calendar days of a launch that starts on `start`.

    Days without sales are absent (not zero).
    """
    daily = orders.groupby(orders["placed_at"].dt.normalize())["total_cents"].sum()
    return daily[daily.index >= start].first("7D")


def stock_levels(stock: pd.DataFrame) -> pd.DataFrame:
    """kg per bean (columns) per stocktake day (rows).

    A bean that was not counted on a day keeps the level from its last count.
    """
    table = stock.pivot(index="taken_on", columns="bean", values="kg")
    return table.fillna(method="ffill")


def as_euros(table: pd.DataFrame) -> pd.DataFrame:
    """Format every cell of a table of cents as euros for the review deck, e.g. "€1,234.50"."""
    return table.applymap(lambda cents: f"€{cents / 100:,.2f}")
