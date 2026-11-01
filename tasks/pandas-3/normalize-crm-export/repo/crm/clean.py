"""Cleaning steps applied to the CRM export before it is synced to billing."""

from __future__ import annotations

import pandas as pd


def latest_per_customer(customers: pd.DataFrame) -> pd.DataFrame:
    """Keep only the most recently updated row for each customer_id, ordered by customer_id."""
    ordered = customers.sort_values(["customer_id", "updated_at"])
    return ordered.drop_duplicates("customer_id", keep="last").reset_index(drop=True)
