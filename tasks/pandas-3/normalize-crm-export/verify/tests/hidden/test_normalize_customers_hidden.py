import math
from pathlib import Path

import pandas as pd

from crm.clean import normalize_customers
from crm.export import load_export
from crm.sync import build_sync_batch

DATA = Path(__file__).resolve().parent.parent.parent / "data"
MISSING = None


def values(series: pd.Series) -> list:
    """Column values with every kind of missing value reported as None."""
    out = []
    for value in series.tolist():
        if value is None or value is pd.NA or (isinstance(value, float) and math.isnan(value)):
            out.append(MISSING)
        else:
            out.append(value)
    return out


def raw() -> pd.DataFrame:
    return load_export(DATA / "customers.csv")


def test_text_columns_are_trimmed_and_collapsed():
    clean = normalize_customers(raw())
    assert values(clean["full_name"]) == ["Ana Silva", "Bob Stone", "Carla Mendes", "Dmitri", "Eve"]
    assert values(clean["company"]) == ["Silva & Filhos", MISSING, "Mendes Lda", MISSING, "Acme Corp"]
    assert values(clean["notes"]) == ["called twice, wants invoice", MISSING, MISSING, "VIP since 2019", "ok"]
    assert values(clean["customer_id"]) == ["c-001", "c-002", "c-003", "c-004", "c-005"]


def test_emails_are_trimmed_and_lowercased():
    clean = normalize_customers(raw())
    assert values(clean["email"]) == [
        "ana.silva@example.com",
        "bob@example.org",
        "carla@example.net",
        "dmitri@example.com",
        "eve@example.io",
    ]


def test_missing_country_becomes_unknown():
    clean = normalize_customers(raw())
    assert values(clean["country"]) == ["PT", "unknown", "unknown", "DE", "FR"]


def test_missing_orders_become_zero_and_the_column_is_integer():
    clean = normalize_customers(raw())
    assert pd.api.types.is_integer_dtype(clean["orders"])
    assert values(clean["orders"]) == [3, 0, 12, 0, 1]


def test_new_free_text_columns_are_cleaned_too():
    customers = raw()
    customers["referrer"] = ["  partner   portal ", None, "newsletter", "\t", "ads  "]
    clean = normalize_customers(customers)
    assert values(clean["referrer"]) == ["partner portal", MISSING, "newsletter", MISSING, "ads"]


def test_numbers_and_dates_are_left_alone():
    before = raw()
    clean = normalize_customers(before)
    assert list(clean.columns) == list(before.columns)
    assert clean.index.equals(before.index)
    pd.testing.assert_series_equal(clean["lifetime_value_eur"], before["lifetime_value_eur"])
    pd.testing.assert_series_equal(clean["updated_at"], before["updated_at"])


def test_the_raw_export_is_not_modified():
    customers = raw()
    untouched = raw()
    normalize_customers(customers)
    pd.testing.assert_frame_equal(customers, untouched)


def test_sync_batch_is_normalized_and_audit_is_raw():
    batch, audit = build_sync_batch(DATA / "customers.csv")
    assert values(batch["email"])[0] == "ana.silva@example.com"
    assert values(batch["country"]) == ["PT", "unknown", "unknown", "DE", "FR"]
    pd.testing.assert_frame_equal(audit, raw())
