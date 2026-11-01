"""Hidden checks for daily_stats against a plain-Python reference."""

import csv
import math
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import polars as pl
import pytest

from telemetry.daily import daily_stats

EXPORT = Path(__file__).parent / "sensor_fixtures" / "export.csv"
COLUMNS = ["sensor_id", "day", "readings", "temp_min", "temp_max", "temp_mean", "humidity_mean"]


def _measurement(text):
    if text == "":
        return None
    value = float(text)
    return None if math.isnan(value) else value


def expected(path):
    groups = defaultdict(lambda: {"t": [], "h": []})
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            day = datetime.fromisoformat(r["recorded_at"]).date()
            g = groups[(r["sensor_id"], day)]
            t, h = _measurement(r["temperature_c"]), _measurement(r["humidity_pct"])
            if t is not None:
                g["t"].append(t)
            if h is not None:
                g["h"].append(h)
    rows = []
    for (sensor, day), g in sorted(groups.items()):
        t, h = g["t"], g["h"]
        rows.append(
            {
                "sensor_id": sensor,
                "day": day,
                "readings": len(t),
                "temp_min": min(t) if t else None,
                "temp_max": max(t) if t else None,
                "temp_mean": sum(t) / len(t) if t else None,
                "humidity_mean": sum(h) / len(h) if h else None,
            }
        )
    return rows


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return a == pytest.approx(b, rel=1e-9, abs=1e-9)


def _check(path):
    out = daily_stats(str(path))
    assert isinstance(out, pl.DataFrame)
    missing = [c for c in COLUMNS if c not in out.columns]
    assert not missing, f"missing columns: {missing}"
    got = out.select(COLUMNS).to_dicts()
    exp = expected(path)
    assert [(r["sensor_id"], r["day"]) for r in got] == [(r["sensor_id"], r["day"]) for r in exp]
    return got, exp


def test_one_row_per_sensor_and_utc_day():
    got, _ = _check(EXPORT)
    assert all(isinstance(r["day"], date) and not isinstance(r["day"], datetime) for r in got)


def test_readings_count_only_real_measurements():
    got, exp = _check(EXPORT)
    assert [r["readings"] for r in got] == [r["readings"] for r in exp]


@pytest.mark.parametrize("column", ["temp_min", "temp_max", "temp_mean", "humidity_mean"])
def test_statistics_ignore_failed_probes(column):
    got, exp = _check(EXPORT)
    wrong = [(g["sensor_id"], g["day"], g[column], e[column]) for g, e in zip(got, exp) if not _close(g[column], e[column])]
    assert wrong == [], f"{len(wrong)} wrong {column} values, e.g. {wrong[:3]}"


def test_day_with_a_dead_probe_still_reported():
    got, _ = _check(EXPORT)
    row = next(r for r in got if r["sensor_id"] == "gh2-center" and r["day"] == date(2026, 10, 3))
    assert row["readings"] == 0
    assert row["temp_mean"] is None and row["temp_min"] is None and row["temp_max"] is None
    assert row["humidity_mean"] is not None


def test_sample_export():
    got, exp = _check(Path("data/sample.csv"))
    for g, e in zip(got, exp):
        for column in COLUMNS[2:]:
            assert _close(g[column], e[column]), (g["sensor_id"], g["day"], column)
