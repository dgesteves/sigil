"""Reading the nightly CRM export."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


def load_export(path: str | Path) -> pd.DataFrame:
    """Read the CRM's customers CSV exactly as exported (no cleaning)."""
    return pd.read_csv(path, parse_dates=["updated_at"])
