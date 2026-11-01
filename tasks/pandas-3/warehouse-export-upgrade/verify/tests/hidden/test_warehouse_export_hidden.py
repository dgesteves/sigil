# Output of the same functions on pandas 2.3.3 (the version this module shipped with) for
# fixtures/events.csv. The warehouse loader requires these values to stay identical.
import json
from pathlib import Path

import pandas as pd

from export.events import PLANS, ROW_COLUMNS, load_events, plan_summary, session_table, to_warehouse_rows

HERE = Path(__file__).resolve().parent
FIXTURE = HERE.parent.parent / "fixtures" / "events.csv"
EXPECTED = json.loads((HERE / "expected_export_pandas_2_3.json").read_text())


def normalise(frame: pd.DataFrame) -> list[dict]:
    """Rows as plain Python values: numbers stay numbers, everything else is compared as text."""
    out = []
    for row in frame.to_dict(orient="records"):
        clean = {}
        for key, value in row.items():
            value = value.item() if hasattr(value, "item") else value
            clean[key] = value if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
        out.append(clean)
    return out


def test_event_rows_match_the_pandas_2_3_export():
    rows = to_warehouse_rows(load_events(FIXTURE))
    assert list(rows.columns) == ROW_COLUMNS
    assert rows["event_ms"].dtype == "int64"
    assert rows["amount_cents"].dtype == "int64"
    got = normalise(rows)
    for expected, actual in zip(EXPECTED["rows"], got, strict=True):
        assert actual == expected, f"{expected['event_id']}: {actual} != {expected}"


def test_event_ms_is_epoch_milliseconds_rounded_down():
    events = load_events(FIXTURE).head(2).copy()
    events["ts"] = pd.to_datetime(
        pd.Series(["2026-03-29T10:00:00.123456Z", "2026-03-29T10:00:01.999999Z"]), utc=True
    )
    rows = to_warehouse_rows(events)
    assert rows["event_ms"].tolist() == [1774778400123, 1774778401999]


def test_sessions_match_the_pandas_2_3_export():
    sessions = session_table(load_events(FIXTURE))
    for column in ["start_ms", "end_ms", "duration_s", "events"]:
        assert sessions[column].dtype == "int64", column
    got = normalise(sessions)
    for expected, actual in zip(EXPECTED["sessions"], got, strict=True):
        assert actual == expected, f"{expected['session_id']}: {actual} != {expected}"


def test_session_duration_is_whole_seconds_rounded_down():
    events = load_events(FIXTURE).head(2).copy()
    events["session_id"] = "s-x"
    events["ts"] = pd.to_datetime(
        pd.Series(["2026-03-29T10:00:00.000Z", "2026-03-29T10:02:05.999Z"]), utc=True
    )
    sessions = session_table(events)
    assert sessions["duration_s"].tolist() == [125]
    assert sessions["start_ms"].tolist() == [1774778400000]
    assert sessions["end_ms"].tolist() == [1774778525999]


def test_plan_summary_matches_the_pandas_2_3_export():
    summary = plan_summary(load_events(FIXTURE))
    assert normalise(summary) == EXPECTED["plans_all"]


def test_plan_summary_keeps_plans_without_events():
    events = load_events(FIXTURE)
    summary = plan_summary(events[events["plan"] != "enterprise"])
    assert [str(plan) for plan in summary["plan"]] == PLANS
    assert normalise(summary) == EXPECTED["plans_no_enterprise"]
    for column in ["events", "users", "revenue_cents"]:
        assert pd.api.types.is_integer_dtype(summary[column]), column
