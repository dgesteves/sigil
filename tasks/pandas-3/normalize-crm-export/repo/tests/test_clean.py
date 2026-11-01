from pathlib import Path

import pandas as pd

from crm.clean import latest_per_customer
from crm.export import load_export

DATA = Path(__file__).resolve().parent.parent / "data"


def test_load_export_parses_update_times():
    customers = load_export(DATA / "customers.csv")
    assert len(customers) == 5
    assert pd.api.types.is_datetime64_any_dtype(customers["updated_at"])


def test_latest_per_customer_keeps_the_newest_row():
    customers = pd.DataFrame(
        {
            "customer_id": ["c-2", "c-1", "c-2"],
            "email": ["old@example.org", "one@example.org", "new@example.org"],
            "updated_at": pd.to_datetime(["2026-01-01", "2026-01-02", "2026-01-03"]),
        }
    )
    latest = latest_per_customer(customers)
    assert latest["customer_id"].tolist() == ["c-1", "c-2"]
    assert latest["email"].tolist() == ["one@example.org", "new@example.org"]
