---
name: flaky-tests
description: Diagnose and fix flaky, order-dependent, time-dependent and hollow Python tests at the root cause, for pytest 9.x (checked on 9.2.0) with pytest-asyncio 1.x, pytest-randomly 5 and time-machine 3. Covers state leaking between tests (env vars, lru_cache, module globals, fixed temp paths), dates, timezones and DST (date.today() vs UTC, month ends, leap days), what time-machine and freezegun freeze and what they don't (time.monotonic), real sleeps and duration asserts, seeded randomness and PYTHONHASHSEED, async tests that never run their asserts, the removed event_loop fixture, and proving a fix with seeds, edge instants and mutation checks. Use when a test passes locally but fails in CI, fails intermittently, only on some days or timezones, under pytest-randomly or when run alone, on "fixture 'event_loop' not found", "coroutine ... was never awaited" or "attached to a different loop", or before reaching for retries, sleeps, wider tolerances, skip or xfail.
license: MIT
---

# Flaky Python tests

A flaky test reads an input it does not control: test order and shared state, the wall clock,
the local timezone, real elapsed time, a random generator, hash ordering, or the event loop's
scheduling. The fix is always to find that input and control it. Retrying, sleeping longer,
widening a tolerance, `skip`, `xfail` or deleting the test only hides it, and usually hides real
bugs with it.

Checked in November 2026 against pytest 9.2.0, pytest-asyncio 1.4.1, pytest-randomly 5.0.0,
time-machine 3.6.0, freezegun 1.5.5 and Python 3.14. The behaviours below were reproduced on those
versions; release-note facts are cited in [references/sources.md](references/sources.md).

## 1. Workflow

1. **Reproduce first.** Get the failing seed, instant, timezone or order before changing anything
   (section 7). A fix you can't see failing first is a guess.
2. **Name the uncontrolled input** with the triage table below.
3. **Control it** in the test: a fixture that resets state, an injected clock or `now=`, a frozen
   clock, a seeded or stub RNG, a fake sleep, an explicit event. Prefer the injection points the
   code already has (`clock=`, `sleep=`, `rng=`, `now=`, `today=`) over patching globals.
4. **Keep the claim.** The test must still fail when the behaviour it names breaks. If a check only
   holds on some days, assert the real rule at fixed inputs (including the edge case) instead of
   dropping it. Never compute the expected value with the function under test.
5. **Prove it**: random orders with several seeds, each test alone, the edge instants and timezones,
   and temporarily break the code to watch the test go red (section 7).

| Symptom | Usual input | First experiment |
| --- | --- | --- |
| Fails under pytest-randomly, passes with `-p no:randomly` | shared state between tests | `--randomly-seed=<seed from the log>`, then run the failing test alone |
| Fails alone, passes in the full run | depends on an earlier test's side effect | `pytest path::test_name` |
| Fails on some dates (month end, December, Feb 29) | `date.today()` arithmetic | freeze at Jan 31, Dec 15, Feb 29 |
| Fails for people in other timezones, or near midnight | local date vs UTC date | `TZ=Pacific/Auckland pytest`, `TZ=America/Los_Angeles pytest` |
| Fails once or twice a year | DST transition | freeze at both transitions of the zone in question |
| Fails on busy CI runners | real sleeps or duration assertions | fake the clock and the sleep |
| Fails with different random data | unseeded `random`, `uuid4`, `secrets` | rerun with several `--randomly-seed` values |
| Order of a set or dict of strings differs between runs | hash randomization | `PYTHONHASHSEED=1 pytest` vs `PYTHONHASHSEED=2 pytest` |
| Passes but tests nothing; "coroutine ... was never awaited" | missing `await` | `-W error::RuntimeWarning -W error::pytest.PytestUnraisableExceptionWarning` |
| `fixture 'event_loop' not found` | pytest-asyncio 1.x removed it | `asyncio.get_running_loop()` (section 5) |
| `0.1 + 0.2 == 0.3` style failures | float rounding | `pytest.approx` |

## 2. Shared state and test order

pytest-randomly (on whenever it is installed) shuffles modules, then classes, then functions, and
reseeds `random` before every test from the base seed and the test id. It prints
`Using --randomly-seed=N`; rerun that order with `--randomly-seed=N` (or `last`, which needs the
cache provider). `-p no:randomly` restores file order. 5.0 shuffles inside a hook wrapper before
every other plugin, so a seed now gives the same order in every environment.

Leaks to look for in the test **and** in the code under test:

- `os.environ[...] = ...` or `del os.environ[...]` in a test body. Use `monkeypatch.setenv` /
  `monkeypatch.delenv(name, raising=False)`; they are undone after the test even when it fails.
- Cached readers: `@functools.cache`, `@lru_cache`, module-level "loaded once" globals, singletons,
  class attributes. A test that sets an env var must also clear the cache that read it, and so must
  the next test. `try/finally` that restores the env var but not the cache still leaks.
- In-process registries and overrides (feature flags, plugin registries, metrics, signal handlers,
  logging handlers) that the code exposes a reset for.
- Fixed paths (`/tmp/thing.json`, `Path(tempfile.gettempdir()) / "x"`, files in the repo). Use
  `tmp_path`; it is unique per test and safe under pytest-xdist.
- `os.chdir`, `sys.path`, `sys.modules`, monkeypatching outside a fixture (`monkeypatch` works only
  as a fixture or `pytest.MonkeyPatch.context()`).
- A higher-scoped fixture (`module`, `session`) whose object a test mutates.
- A test that only passes because an earlier test wrote a file, set an env var or warmed a cache.

Reset pattern, in `conftest.py`, so every test starts from documented defaults and leaves nothing:

```python
import json

import pytest

from pricing import catalog
from pricing.config import load_config

PRICING_VARS = ("PRICING_REGION", "PRICING_CURRENCY", "PRICING_CATALOG")


def _reset():
    load_config.cache_clear()     # lru_cache over the PRICING_* variables
    catalog.unload()              # module-level "loaded once" data
    catalog.clear_price_overrides()


@pytest.fixture(autouse=True)
def clean_pricing(monkeypatch):
    for name in PRICING_VARS:
        monkeypatch.delenv(name, raising=False)   # the developer's shell must not leak in
    _reset()
    yield
    _reset()


@pytest.fixture
def catalog_file(tmp_path, monkeypatch):
    def write(entries):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps(entries))
        monkeypatch.setenv("PRICING_CATALOG", str(path))
        load_config.cache_clear()
        catalog.unload()
    return write
```

Reset before **and** after: before protects the test from whatever ran earlier (including state
from import time), after protects the next test if it doesn't use the fixture. Delete the env vars
the code reads, not only the ones the tests set: CI and laptops export different things.

Details, including xdist and fixture-scope traps: [references/isolation-and-order.md](references/isolation-and-order.md).

## 3. Clocks, calendars and timezones

Facts that cause most date flakes:

- `date.today()` and naive `datetime.now()` are **local** time. Code that bills, schedules or logs
  in UTC computes "today" with `datetime.now(UTC).date()`. Between local and UTC midnight the two
  dates differ: every morning in Auckland, every evening in Los Angeles.
- `d.replace(month=d.month + 1)` raises in December and for days 29-31; `d.replace(year=d.year - 1)`
  raises on Feb 29; "same day next month" is a clamping rule, not arithmetic. A test that does the
  arithmetic itself fails on those days even when the code is right.
- A local day is not 24 hours twice a year. "The next 09:00 is at most 24 hours away" is false on
  the day clocks go back.
- `datetime.utcnow()` is deprecated since 3.12 and returns a naive datetime; don't introduce it.

**Prefer explicit inputs.** If the function takes `now=` / `today=` (or a clock), pass fixed values
and state the edge cases as their own cases:

```python
@pytest.mark.parametrize(("issued", "today", "expected"), [
    (date(2026, 3, 10), date(2026, 3, 20), date(2026, 4, 10)),
    (date(2026, 1, 31), date(2026, 2, 3), date(2026, 2, 28)),    # clamps
    (date(2026, 12, 5), date(2026, 12, 15), date(2027, 1, 5)),   # crosses the year
])
def test_loan_due_date(issued, today, expected):
    assert loan_due_date(issued, today=today) == expected
```

**Otherwise freeze the wall clock** with time-machine (C-level, fast) or freezegun:

```python
import time_machine
from datetime import UTC, datetime

@pytest.mark.time_machine(datetime(2026, 12, 31, 23, 30, tzinfo=UTC), tick=False)
def test_label_on_new_years_eve(): ...

def test_label_after_move(time_machine):               # fixture form
    time_machine.move_to(datetime(2028, 2, 29, 12, tzinfo=UTC), tick=False)
    ...
    time_machine.shift(timedelta(hours=13))
```

| | time-machine 3.6 | freezegun 1.5.5 |
| --- | --- | --- |
| `time.time()`, `datetime.now()`, `date.today()` | frozen or travelled | frozen |
| `time.monotonic()`, `time.perf_counter()` | **real time, never mocked** (so asyncio keeps working) | frozen; `tick()` advances it; `real_asyncio=True` keeps the event loop on real time |
| local timezone | mocked (via `time.tzset()`, Unix only) when the destination has `tzinfo=ZoneInfo(...)` or `UTC`; a POSIX timestamp or naive destination leaves `TZ` alone | ignored: while frozen, naive `datetime.now()` returns the frozen UTC time whatever `TZ` says, unless you pass `tz_offset=` |
| naive destinations | `naive_mode` (3.2+): default `MIXED` treats naive `datetime`s as UTC and naive strings as local; `LOCAL`, `UTC`, `ERROR` available | UTC |
| `tick` | `tick=True` by default: time moves on from the destination | frozen unless `tick=True` |

So time-machine **cannot** control code that measures intervals with `time.monotonic()` (caches,
rate limiters, timeouts, retry budgets): `travel()` and `shift()` change the wall clock only. Inject
a clock instead (section 4). time-machine raises `RuntimeError` if you start it while freezegun is
active; don't mix them.

Edge instants worth a parametrized case (or a CI matrix): the 29th-31st, the last day of February
in leap and non-leap years, mid-December, Dec 31 23:30 UTC, both DST transitions of every zone the
code handles (Europe: last Sunday of March and October), and 22:30-03:00 UTC with `TZ` set to a zone
ahead of UTC (`Pacific/Auckland`) and one behind (`America/Los_Angeles`). More in
[references/clocks-and-time.md](references/clocks-and-time.md).

## 4. Real time: sleeps, durations and timeouts

A test that sleeps and then asserts on what a clock says will fail on a machine that pauses or is
slow: `sleep(s)` guarantees *at least* `s`. Measured-duration bounds (`assert elapsed < 0.1`) fail
the same way. Making the margins bigger only makes the suite slower and the flake rarer.

Drive time yourself. A manual clock plus a sleep that advances it:

```python
class ManualClock:
    def __init__(self) -> None:
        self.now = 0.0              # start at 0: see the float note below
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds
        await asyncio.sleep(0)      # still yield, as a real sleep would


@pytest.mark.asyncio
async def test_throttle_waits_for_the_window(manual_clock):
    throttle = Throttle(per_second=4, clock=manual_clock, sleep=manual_clock.sleep)
    await throttle.wait()
    await throttle.wait()
    assert manual_clock.slept == [pytest.approx(0.25)]
```

- Assert on **what the code asked for** (the sleep durations, the number of attempts, whether the
  entry is still there after `advance(29.9)`), not on wall time that passed.
- `unittest.mock.AsyncMock()` works as a recording sleep for code that only awaits it; when the code
  re-checks a clock after sleeping, the fake sleep must advance that clock (`side_effect=advance`)
  or the code spins forever.
- Float spacing: at `1000.0` the next representable float is about `1.1e-13` away, so
  `1000.0 + 4.5e-14 == 1000.0`. Code that sleeps "the remaining fraction" can then loop forever on
  a manual clock. Start manual clocks at 0, or advance in larger steps.
- Patching `time.monotonic` globally also changes the asyncio event loop's clock (`loop.time()`);
  prefer injection or patching the reference in the module under test.
- Synchronise with events, not sleeps: `await asyncio.wait_for(done.wait(), 1)` or
  `async with asyncio.timeout(1):` as a safety net around something that signals completion,
  `await queue.join()`, or polling a condition with a fake sleep.
- Jitter and backoff: inject the RNG (`random.Random(1234)` or a stub whose `uniform(a, b)` returns
  `b`) and assert exact delays; separately assert the bounds with a seeded `Random`.

## 5. Async tests (pytest 9, pytest-asyncio 1.x)

What changed, and what each error means:

- pytest 8.4+: an `async def` test with no async plugin handling it **fails** ("async def functions
  are not natively supported") instead of being skipped. pytest 9: a test that requests an async
  fixture no plugin handles is an **error** ("requested an async fixture ... with no plugin or hook
  that handled it"). A sync test that *returns* a coroutine fails the same way; one that returns any
  other value still passes, with only a `PytestReturnNotNoneWarning` (`return a == b` checks nothing).
- pytest-asyncio 1.0 **removed the `event_loop` fixture**: "fixture 'event_loop' not found". Use
  `asyncio.get_running_loop()` inside the test. Do not re-create an `event_loop` fixture in
  `conftest.py` (the old recipe, deprecated since 0.22): the test still runs in pytest-asyncio's own loop, so futures
  and callbacks created on your loop fail with "got Future ... attached to a different loop" or never
  fire.
- Strict mode is the default: async tests need `@pytest.mark.asyncio` and async fixtures need
  `@pytest_asyncio.fixture`. With `asyncio_mode = "auto"` both are implicit. Set
  `asyncio_default_fixture_loop_scope = "function"` to silence the "unset" deprecation warning. Use
  `@pytest.mark.asyncio(loop_scope="module")` and `@pytest_asyncio.fixture(loop_scope=...)` for
  shared loops; 1.4 deprecates overriding `event_loop_policy` in favour of the
  `pytest_asyncio_loop_factories` hook.

**Hollow tests pass without running their checks.** Look for them whenever you touch async tests:

| Pattern | Why it passes | Fix |
| --- | --- | --- |
| `assert fetch_user(1)` in a sync test | a coroutine object is truthy; nothing runs | make the test async and `assert await ... == expected` |
| `check_results(...)` (an `async def` helper) without `await` | the helper's asserts never execute | `await check_results(...)` |
| `asyncio.create_task(check())` and return | the task may not finish before the test does, and its failure is only logged ("Task exception was never retrieved") | `await` it, or run it in an `asyncio.TaskGroup` |
| a hand-made fake whose async method is a plain `Mock` | the code under test gets a non-awaitable, and an `except Exception` around the call hides the `TypeError` | `AsyncMock()`, then `assert_awaited_once_with(...)` |

Python warns `RuntimeWarning: coroutine '...' was never awaited` when such a coroutine is
collected. `-W error::RuntimeWarning` alone does **not** fail the test (the warning is raised in a
finalizer and pytest reports it as `PytestUnraisableExceptionWarning`). To make hollow tests fail:

```toml
[tool.pytest.ini_options]
filterwarnings = ["error::RuntimeWarning", "error::pytest.PytestUnraisableExceptionWarning"]
```

Fire-and-forget tasks raise no warning (at most an asyncio log record in the captured log), so only
reading the test finds them. More in
[references/async-tests.md](references/async-tests.md).

## 6. Randomness, hashing and floats

- pytest-randomly resets `random.seed()` before each test, differently per test and per base seed.
  A test that depends on particular random values passes for some seeds only. Seed locally
  (`rng = random.Random(42)`) and pass it in, or stub the RNG; assert properties for random data and
  exact values only for seeded data. pytest-randomly also reseeds Faker, factory_boy, Model Bakery,
  NumPy's legacy global state and Polyfactory, not `secrets`, `uuid4()` or `numpy.random.default_rng()`.
- `str`/`bytes` hashes are randomized per process (`PYTHONHASHSEED`), so the iteration order of a
  `set` of strings changes between runs (a `dict` keeps insertion order). Compare sets as sets, sort
  before comparing lists, never assert on `", ".join(some_set)`.
- Floats: `assert total == pytest.approx(0.3)`, `pytest.approx([...])`, `pytest.approx({...})`.
  9.2 raises `TypeError` for nested containers (`approx([{"k": 1}])`) instead of silently comparing
  unequal: compare inner items one by one.
- Ids and timestamps generated in the code under test (uuid, `now()`) belong in the "inject or
  freeze" bucket, not in exact-match assertions.

## 7. Prove the fix

```sh
# random orders, several seeds (and hash seeds)
for s in 1 2 3 4 5 6 7 8; do PYTHONHASHSEED=$s python -m pytest -q -p randomly --randomly-seed=$s || break; done
# file order, and each test on its own
python -m pytest -q -p no:randomly
python -m pytest --collect-only -q -p no:randomly | grep '::' | sed 's/\[.*//' | sort -u \
  | while read -r t; do python -m pytest -q -p no:randomly "$t" >/dev/null || echo "FAILS ALONE: $t"; done
# other timezones
TZ=Pacific/Auckland python -m pytest -q; TZ=America/Los_Angeles python -m pytest -q
# hollow async tests
python -m pytest -q -W error::RuntimeWarning -W error::pytest.PytestUnraisableExceptionWarning
```

- Edge dates: add a session-level time travel in a throwaway `conftest.py` (or a CI matrix) and run
  the suite at each instant from section 3; tests that control their own clock are unaffected. Pass
  a POSIX timestamp to `time_machine.travel()` if you want `TZ` to stay in effect.
- Mutation check: break the code under test in the way each test claims to catch (remove the clamp,
  invert the comparison, drop the retry limit), run the suite, see red, revert. A test that stays
  green has lost its claim.
- `--lf` reruns last failures, `-x` stops at the first, `--randomly-seed=last` reruns the last order.
- Don't keep `pytest-rerunfailures`, `flaky` markers, `xfail(strict=False)` or `-p no:randomly` in
  config as "the fix". If a quarantine is unavoidable, make it explicit and tracked, not silent.

Details and a reusable session clock plugin: [references/proving-a-fix.md](references/proving-a-fix.md).

## 8. Anti-patterns

| Don't | Do |
| --- | --- |
| `time.sleep(0.2)` "to be safe", larger TTLs and windows | a manual clock and a fake sleep |
| `assert elapsed < 0.5` | assert the requested delays or the number of attempts |
| `time_machine.shift()` to expire a `time.monotonic()` cache | inject the clock (`clock=`), or patch the module's reference |
| expected value from `date.today()` arithmetic | fixed dates, plus the month-end / December / leap-day cases |
| `datetime.now(UTC).date()` in the test and calling the function without `today=` | pass `today=` / `now=`, or freeze the clock |
| `os.environ["X"] = ...` in a test | `monkeypatch.setenv`, plus clearing the cache that read it |
| a shared file under `/tmp` | `tmp_path` |
| re-adding an `event_loop` fixture | `asyncio.get_running_loop()` |
| `assert some_coroutine()`; un-awaited async helpers | `await`, and the two `filterwarnings` errors |
| reruns, `xfail`, `skip`, `-p no:randomly` | the root cause |
| computing the expectation with the function under test | an independent expected value |

## References

- [Shared state, order, fixtures and xdist](references/isolation-and-order.md)
- [Clocks, calendars, timezones; time-machine and freezegun](references/clocks-and-time.md)
- [Async tests with pytest-asyncio 1.x](references/async-tests.md)
- [Proving a fix: matrices, session clock plugin, mutation checks](references/proving-a-fix.md)
- [Sources checked](references/sources.md)
