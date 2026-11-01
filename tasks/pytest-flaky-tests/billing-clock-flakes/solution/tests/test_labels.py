from datetime import date, timedelta

import pytest

from billing.schedule import due_label

TODAY = date(2026, 3, 18)


@pytest.mark.parametrize(
    ("offset", "label"),
    [
        (0, "due today"),
        (1, "due tomorrow"),
        (5, "due in 5 days"),
        (-1, "overdue by 1 day"),
        (-3, "overdue by 3 days"),
    ],
)
def test_due_label(offset, label):
    assert due_label(TODAY + timedelta(days=offset), today=TODAY) == label
