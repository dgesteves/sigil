from datetime import UTC, datetime, timedelta

from billing.schedule import next_reminder


def test_reminder_is_at_nine_local_time():
    reminder = next_reminder("Europe/Lisbon")
    assert (reminder.hour, reminder.minute) == (9, 0)
    assert reminder.tzinfo is not None


def test_reminder_is_in_the_next_24_hours():
    now = datetime.now(UTC)
    reminder = next_reminder("Europe/Lisbon")
    assert timedelta(0) < reminder - now <= timedelta(hours=24)
