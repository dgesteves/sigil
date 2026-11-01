from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from billing.schedule import next_reminder

LISBON = ZoneInfo("Europe/Lisbon")


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        # 08:00 local: today's 09:00 is still ahead
        (datetime(2026, 3, 18, 8, 0, tzinfo=UTC), datetime(2026, 3, 18, 9, 0, tzinfo=LISBON)),
        # 13:00 local in summer time: tomorrow
        (datetime(2026, 6, 20, 12, 0, tzinfo=UTC), datetime(2026, 6, 21, 9, 0, tzinfo=LISBON)),
        # Saturday 09:30 before clocks go back: the next 09:00 is 24.5 hours away
        (datetime(2026, 10, 24, 8, 30, tzinfo=UTC), datetime(2026, 10, 25, 9, 0, tzinfo=LISBON)),
    ],
)
def test_reminder_is_the_next_nine_oclock_local_time(now, expected):
    reminder = next_reminder("Europe/Lisbon", now=now)
    assert reminder == expected
    assert (reminder.hour, reminder.minute) == (9, 0)
    assert reminder > now
