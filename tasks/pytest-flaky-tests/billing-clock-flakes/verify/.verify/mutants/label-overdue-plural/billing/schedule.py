"""Date rules for subscriptions.

All "current time" defaults are UTC: billing runs in UTC, and customers see dates in UTC on invoices.
Pass `now`/`today` explicitly to evaluate a rule at another instant.
"""

import calendar
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

TRIAL_LENGTH = timedelta(days=14)


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_today() -> date:
    return utc_now().date()


def trial_ends_at(signed_up_at: datetime) -> datetime:
    if signed_up_at.tzinfo is None:
        raise ValueError("signed_up_at must be timezone-aware")
    return signed_up_at + TRIAL_LENGTH


def is_trial_active(signed_up_at: datetime, now: datetime | None = None) -> bool:
    now = utc_now() if now is None else now
    return now < trial_ends_at(signed_up_at)


def add_months(day: date, months: int, anchor_day: int | None = None) -> date:
    """Same day of the month `months` later, clamped to the last day of shorter months."""
    anchor_day = day.day if anchor_day is None else anchor_day
    month_index = day.month - 1 + months
    year, month = day.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def next_renewal(started_on: date, today: date | None = None) -> date:
    """First monthly anniversary of `started_on` that is strictly after today (UTC)."""
    today = utc_today() if today is None else today
    months = (today.year - started_on.year) * 12 + (today.month - started_on.month)
    candidate = add_months(started_on, max(months, 0), started_on.day)
    while candidate <= today:
        months += 1
        candidate = add_months(started_on, months, started_on.day)
    return candidate


def due_label(due_on: date, today: date | None = None) -> str:
    """Text shown next to an invoice: relative to today's date in UTC."""
    today = utc_today() if today is None else today
    days = (due_on - today).days
    if days == 0:
        return "due today"
    if days == 1:
        return "due tomorrow"
    if days > 1:
        return f"due in {days} days"
    if days == -1:
        return "overdue by 1 days"
    return f"overdue by {-days} days"


def next_reminder(timezone: str, now: datetime | None = None, at: time = time(9, 0)) -> datetime:
    """Next time the customer's wall clock in `timezone` shows `at`, strictly after now."""
    zone = ZoneInfo(timezone)
    local_now = (utc_now() if now is None else now).astimezone(zone)
    candidate = datetime.combine(local_now.date(), at, tzinfo=zone)
    if candidate <= local_now:
        candidate = datetime.combine(local_now.date() + timedelta(days=1), at, tzinfo=zone)
    return candidate
