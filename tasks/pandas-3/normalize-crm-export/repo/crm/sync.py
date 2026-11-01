"""Builds the batch that the billing sync job uploads."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from crm import clean
from crm.export import load_export


def build_sync_batch(path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (batch, audit): the cleaned rows to upload and the raw rows for the audit log.

    The audit log must show the export exactly as the CRM produced it.
    """
    raw = load_export(path)
    batch = clean.latest_per_customer(raw)
    return batch, raw
