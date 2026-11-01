# Clocks, calendars and timezones

Checked against time-machine 3.6.0, freezegun 1.5.5 and Python 3.14 (CPython's `datetime`,
`zoneinfo` and `time`).

## Which clock is the code reading?

| Call | Clock | Affected by `TZ` | Frozen by time-machine | Frozen by freezegun |
| --- | --- | --- | --- | --- |
| `time.time()` | wall, UTC epoch | no | yes | yes |
| `datetime.now(UTC)` | wall | no | yes | yes |
| `datetime.now()` (naive) | wall, local | yes | yes | yes, as UTC (see below) |
| `date.today()` | wall, local | yes | yes (mocked directly since 3.3 for Python 3.15) | yes |
| `time.localtime()`, `time.strftime()` | wall, local | yes | yes | yes |
| `time.monotonic()`, `time.perf_counter()` | monotonic | no | **no** | yes |
| `loop.time()` (asyncio) | `time.monotonic()` | no | **no** | yes, unless `real_asyncio=True` |
| `uuid.uuid1()`, `uuid6()`, `uuid7()` | wall | no | yes (caches reset on travel since 3.3) | not checked |

Measured with time-machine 3.6.0 inside `travel(0, tick=False)`: `time.time()` stayed at `0.0`
while `time.monotonic()` and `time.perf_counter()` advanced by the real 0.05 s slept, and
`traveller.shift(60)` moved `time.time()` to `60.0` without changing `time.monotonic()`.

Consequence: to test TTLs, rate limiters, timeouts or backoff that use `time.monotonic()`, inject a
clock or patch the module's reference to it. Wall-clock freezing does nothing for them.

## time-machine 3.6

```python
import time_machine
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

# decorator / context manager
with time_machine.travel(datetime(2026, 3, 29, 0, 30, tzinfo=UTC), tick=False):
    ...

# pytest marker (module-level `pytestmark = ...` works too)
@pytest.mark.time_machine(datetime(2026, 12, 31, 23, 30, tzinfo=UTC), tick=False)
def test_year_end(): ...

# pytest fixture
def test_moves(time_machine):
    time_machine.move_to(datetime(2028, 2, 29, 12, tzinfo=UTC), tick=False)
    time_machine.shift(timedelta(days=1))
```

- `tick=True` (the default) lets time run on from the destination; `tick=False` freezes it.
- Destination types: aware or naive `datetime`, `date` (midnight), POSIX timestamp (`int`/`float`),
  ISO string, `timedelta` (relative to now), a callable or generator, or `None` (now, 3.5+).
- Timezone mocking: when the destination's `tzinfo` is a `ZoneInfo` or `datetime.UTC`,
  time-machine sets the local timezone for the duration (via `time.tzset()`, Unix only). With a UTC
  destination, `time.tzname` became `('UTC', 'UTC')` and `date.today()` the UTC date. A POSIX
  timestamp or naive destination leaves the process `TZ` in effect.
- `naive_mode` (3.2+): `MIXED` (default) reads naive `datetime` objects and `date`s as UTC but naive
  strings as local time; `UTC`, `LOCAL` and `ERROR` are the alternatives. `ERROR` keeps a suite
  from changing meaning with the machine's timezone:

  ```python
  # conftest.py
  import time_machine
  time_machine.naive_mode = time_machine.NaiveMode.ERROR
  ```

  Measured: with `TZ=America/Los_Angeles`, `travel(datetime(2026, 1, 1, 12, 0))` gave
  `datetime.now(UTC) == 12:00Z`, while `travel("2026-01-01 12:00")` gave `20:00Z`.
- Nesting works: an inner `travel()` overrides an outer one and restores it on exit.
- Starting time-machine while freezegun is active raises `RuntimeError` (3.2+).
- `escape_hatch` gives the real clocks inside a travel (for example to log real durations).

## freezegun 1.5.5

- `freeze_time(...)` freezes `time.monotonic()` and `time.perf_counter()` too (measured: a real
  0.05 s sleep showed a 0.0 s difference), and `frozen.tick(delta)` advances them.
- Because asyncio's loop clock freezes with it, use `freeze_time(..., real_asyncio=True)` in async
  tests or the loop's timers never fire.
- It ignores the process timezone: with `TZ=America/Los_Angeles` and `freeze_time("2026-01-01 12:00")`,
  naive `datetime.now()` returned `12:00` and `datetime.now(UTC)` returned `12:00Z`. `tz_offset=`
  shifts what naive `now()` returns.
- It patches names module by module (hence its `ignore=` option for modules that break); time-machine
  patches the C functions once, and ships a migration CLI that rewrites `freeze_time` usages.

## Calendar traps in tests

| Expression in a test | Breaks on |
| --- | --- |
| `d.replace(month=d.month + 1)` | every day in December (month 13) and days 29-31 before shorter months |
| `d.replace(year=d.year - 1)` / `+ 1` | February 29 |
| `d + timedelta(days=30)` as "one month later" | most of the year, silently |
| "same day of month" assertions on monthly schedules | the 29th-31st (correct code clamps) |
| `date.today()` compared with code that uses UTC | hours around midnight in any non-UTC zone |
| `datetime.now()` (naive) passed to code that expects aware datetimes | `TypeError`, or a silent offset |
| "the next 09:00 is within 24 hours" | the day clocks go back (25-hour day) |
| "a day is 86400 seconds" across a local date | both DST transition days |
| week numbers (`%W`, `isocalendar()`) near New Year | the last/first days of the year |

Write the expectation independently of the code under test: a literal date, or a different, simpler
formula you trust. Reusing the module's own helper (`add_months`) to compute the expected value makes
the test pass whatever the helper does.

## Choosing edge instants

For a suite that touches dates, check at least:

- the 30th or 31st before a shorter month, February 28/29 in leap and non-leap years;
- mid-December and December 31 (year rollover, `month + 1`);
- both DST transitions for every zone the code formats or schedules in (EU: the last Sundays of
  March and October, 01:00 UTC; US: the second Sunday of March and the first Sunday of November,
  02:00 local);
- 22:30-03:00 UTC with `TZ` ahead of UTC (`Pacific/Auckland`, `Asia/Tokyo`) and behind it
  (`America/Los_Angeles`, `Pacific/Honolulu`), where the local date differs from the UTC date.

The `python:3.14-slim` image ships `/usr/share/zoneinfo`, so `TZ=Pacific/Auckland` and
`ZoneInfo("Europe/Lisbon")` work there; on Windows, or images without system tzdata, add the
`tzdata` package for `zoneinfo`. POSIX `TZ` strings (`TZ="NZST-12NZDT,M9.5.0,M4.1.0/3"`) work without
any tz database.
