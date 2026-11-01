from datetime import date, timedelta

from billing.schedule import due_label


def test_due_today():
    assert due_label(date.today()) == "due today"


def test_due_tomorrow():
    assert due_label(date.today() + timedelta(days=1)) == "due tomorrow"


def test_due_in_five_days():
    assert due_label(date.today() + timedelta(days=5)) == "due in 5 days"


def test_overdue_by_one_day():
    assert due_label(date.today() - timedelta(days=1)) == "overdue by 1 day"


def test_overdue_by_three_days():
    assert due_label(date.today() - timedelta(days=3)) == "overdue by 3 days"
