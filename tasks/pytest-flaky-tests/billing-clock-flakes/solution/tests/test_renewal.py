from datetime import date

import pytest

from billing.schedule import next_renewal


@pytest.mark.parametrize(
    ("started_on", "today", "expected"),
    [
        (date(2026, 3, 8), date(2026, 3, 18), date(2026, 4, 8)),
        (date(2026, 12, 5), date(2026, 12, 15), date(2027, 1, 5)),  # crosses the year
    ],
)
def test_renews_one_month_after_start(started_on, today, expected):
    assert next_renewal(started_on, today=today) == expected


def test_renewal_after_a_year_keeps_the_day_of_month():
    started_on = date(2025, 6, 20)
    assert next_renewal(started_on, today=date(2026, 6, 20)) == date(2026, 7, 20)


def test_renewal_clamps_to_the_end_of_february():
    assert next_renewal(date(2025, 1, 31), today=date(2025, 2, 10)) == date(2025, 2, 28)
