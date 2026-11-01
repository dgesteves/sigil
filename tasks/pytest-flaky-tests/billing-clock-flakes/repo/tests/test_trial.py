from datetime import UTC, date, datetime, timedelta

from billing.schedule import is_trial_active, trial_ends_at


def test_trial_is_active_on_day_13():
    signed_up_at = datetime.now(UTC) - timedelta(days=13)
    assert is_trial_active(signed_up_at)


def test_trial_is_over_after_14_days():
    signed_up_at = datetime.now(UTC) - timedelta(days=14)
    assert not is_trial_active(signed_up_at)


def test_trial_ends_two_weeks_after_signup():
    ends_at = trial_ends_at(datetime.now(UTC))
    assert ends_at.date() == date.today() + timedelta(days=14)
