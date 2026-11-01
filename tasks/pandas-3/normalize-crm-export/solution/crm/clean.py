"""Cleaning steps applied to the CRM export before it is synced to billing."""

from __future__ import annotations

import pandas as pd


def latest_per_customer(customers: pd.DataFrame) -> pd.DataFrame:
    """Keep only the most recently updated row for each customer_id, ordered by customer_id."""
    ordered = customers.sort_values(["customer_id", "updated_at"])
    return ordered.drop_duplicates("customer_id", keep="last").reset_index(drop=True)


def _text_columns(frame: pd.DataFrame) -> list[str]:
    # pandas 3 reads text as the "str" dtype, not object; keep object too for frames built by hand.
    return frame.select_dtypes(include=["str", "object"]).columns.tolist()


def normalize_customers(customers: pd.DataFrame) -> pd.DataFrame:
    """Return a cleaned copy of the export; the input frame is left untouched.

    - every text column: trimmed, internal whitespace collapsed to one space, blank -> missing
    - email: lowercased
    - country: missing -> "unknown"
    - orders: missing -> 0, integer dtype
    """
    clean = customers.copy()
    for column in _text_columns(clean):
        text = clean[column].str.strip().str.replace(r"\s+", " ", regex=True)
        clean[column] = text.mask(text == "")
    clean["email"] = clean["email"].str.lower()
    clean["country"] = clean["country"].fillna("unknown")
    clean["orders"] = clean["orders"].fillna(0).astype("int64")
    return clean
