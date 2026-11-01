from datetime import UTC, date, datetime, timedelta

from billing.schedule import is_trial_active, trial_ends_at

# Every rule is evaluated at an explicit instant, so the result can't depend on when the suite runs.
NOW = datetime(2026, 3, 18, 15, 30, tzinfo=UTC)


def test_trial_is_active_on_day_13():
    assert is_trial_active(NOW - timedelta(days=13), now=NOW)


def test_trial_is_over_after_14_days():
    assert not is_trial_active(NOW - timedelta(days=14), now=NOW)


def test_trial_ends_two_weeks_after_signup():
    signed_up_at = datetime(2026, 12, 25, 23, 45, tzinfo=UTC)
    assert trial_ends_at(signed_up_at) == datetime(2027, 1, 8, 23, 45, tzinfo=UTC)
    assert trial_ends_at(signed_up_at).date() == date(2027, 1, 8)
