from datetime import date, timedelta

from billing.schedule import next_renewal


def test_renews_one_month_after_start():
    started_on = date.today() - timedelta(days=10)
    assert next_renewal(started_on) == started_on.replace(month=started_on.month + 1)


def test_renewal_after_a_year_keeps_the_day_of_month():
    today = date.today()
    started_on = today.replace(year=today.year - 1)
    assert next_renewal(started_on).day == started_on.day


def test_renewal_clamps_to_the_end_of_february():
    assert next_renewal(date(2025, 1, 31), today=date(2025, 2, 10)) == date(2025, 2, 28)
