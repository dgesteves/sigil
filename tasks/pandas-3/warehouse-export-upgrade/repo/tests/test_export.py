from pathlib import Path

from export.events import PLANS, ROW_COLUMNS, load_events, plan_summary, session_table, to_warehouse_rows

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "events.csv"


def test_rows_have_the_loader_columns():
    rows = to_warehouse_rows(load_events(FIXTURE))
    assert list(rows.columns) == ROW_COLUMNS
    assert len(rows) == 20
    assert rows["event_ms"].dtype == "int64"
    assert rows["amount_cents"].dtype == "int64"
    assert rows["event_ms"].is_monotonic_increasing


def test_rows_are_bucketed_by_utc_hour():
    rows = to_warehouse_rows(load_events(FIXTURE)).set_index("event_id")
    assert rows.loc["e-0005", "hour"] == "2026-03-29T00:00Z"
    assert rows.loc["e-0006", "hour"] == "2026-03-29T01:00Z"
    assert rows.loc["e-0020", "hour"] == "2026-03-29T23:00Z"


def test_amounts_default_to_zero():
    rows = to_warehouse_rows(load_events(FIXTURE)).set_index("event_id")
    assert rows.loc["e-0003", "amount_cents"] == 4900
    assert rows.loc["e-0001", "amount_cents"] == 0


def test_sessions_table_shape():
    sessions = session_table(load_events(FIXTURE))
    assert list(sessions.columns) == ["session_id", "start_ms", "end_ms", "duration_s", "events"]
    assert len(sessions) == 8
    for column in ["start_ms", "end_ms", "duration_s", "events"]:
        assert sessions[column].dtype == "int64"
    assert (sessions["end_ms"] >= sessions["start_ms"]).all()
    assert (sessions["duration_s"] >= 0).all()
    assert sessions["events"].sum() == 20


def test_plan_summary_lists_every_plan():
    summary = plan_summary(load_events(FIXTURE))
    assert [str(plan) for plan in summary["plan"]] == PLANS
    assert summary["events"].sum() == 20
    assert summary["revenue_cents"].sum() == 258200
