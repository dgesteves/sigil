# Sources

Checked on 2026-11-01. Versions current on PyPI that day: pytest 9.2.0 (2026-10-27),
pytest-asyncio 1.4.1 (2026-10-25), pytest-randomly 5.0.0 (2026-09-01), time-machine 3.6.0
(2026-10-25), freezegun 1.5.5 (2025-08-09), on CPython 3.14 (3.14.6 locally, 3.14.10 in the
`python:3.14-slim` image).

## Documentation and changelogs

- pytest changelog (9.2.0, 9.1.x, 9.0.x, 8.4.x): https://docs.pytest.org/en/stable/changelog.html
  (source: `doc/en/changelog.rst` in pytest-dev/pytest)
  - 8.4.0: async tests without a plugin fail instead of being skipped (#11372); returning non-None
    became a failure (#12346), reverted to `PytestReturnNotNoneWarning` in 8.4.1 (#13477).
  - 9.0.0: subtests, native TOML config, strict mode, `PytestRemovedIn9Warning` as errors.
  - 9.1.0: class-scoped instance-method fixtures deprecated (#10819), non-Collection `argvalues`
    deprecated (#13409).
  - 9.2.0: `indirect`/`ids`/`scope` keyword-only in `parametrize` (#8593), higher-scoped
    instance-method fixtures deprecated (#14774), `approx` rejects nested containers (#10210).
- pytest deprecations, "sync test depending on async fixture" (deprecated 8.4, removed 9.0):
  https://docs.pytest.org/en/stable/deprecations.html
- pytest-asyncio changelog (1.0.0 removed `event_loop`; 1.2.0 `--asyncio-debug`; 1.4.0
  `pytest_asyncio_loop_factories`, `event_loop_policy` override deprecated):
  https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html
- pytest-randomly README and changelog (per-test seeds since 4.0.0, hook-wrapper shuffle in 5.0.0,
  `--randomly-seed=last`, reseeded libraries): https://github.com/pytest-dev/pytest-randomly
- time-machine usage docs and changelog (destinations, `tick`, timezone mocking, `naive_mode` in
  3.2.0, freezegun guard in 3.2.0, `date.today()` and uuid fixes in 3.3.0, monotonic not mocked):
  https://time-machine.readthedocs.io/en/latest/
- pytest-xdist how-to (`worker_id`, shared session data with a file lock):
  https://pytest-xdist.readthedocs.io/en/stable/how-to.html
- Python `time` (`monotonic`, `perf_counter`, `tzset`), `datetime` (`utcnow` deprecated in 3.12),
  `zoneinfo`, asyncio debug mode: https://docs.python.org/3.14/library/

## Reproduced by running

With the versions above (local venv on Python 3.14.6, and the `python:3.14-slim` image):

- An un-awaited coroutine asserted for truthiness, and an un-awaited async helper, both pass with
  `RuntimeWarning: coroutine '...' was never awaited`; `-W error::RuntimeWarning` alone still passes
  (reported as `PytestUnraisableExceptionWarning`); adding
  `-W error::pytest.PytestUnraisableExceptionWarning`, or the same two entries in `filterwarnings`,
  fails both. A `create_task()` that is never awaited passes and only logs "Task exception was never
  retrieved".
- `event_loop` requested on pytest-asyncio 1.4.1: "fixture 'event_loop' not found". A home-made
  `event_loop` fixture plus `event_loop.create_future()` / `call_soon()`: "got Future ... attached
  to a different loop". `asyncio.get_running_loop()` works.
- An `async def` fixture decorated with `@pytest.fixture` in strict mode, and a sync test requesting
  an async fixture, both error with "requested an async fixture ... This is an error".
- An unmarked `async def` test, and a sync test returning a coroutine, fail with "async def
  functions are not natively supported". A sync test returning `1` passes with
  `PytestReturnNotNoneWarning`.
- time-machine `travel(0, tick=False)`: `time.time()` frozen at 0.0 while `time.monotonic()` and
  `time.perf_counter()` advanced by a real 0.05 s sleep; `shift(60)` moved only the wall clock;
  asyncio `loop.time()` kept real time. A float-timestamp destination kept `TZ=Europe/Lisbon`
  (`time.tzname == ('WET', 'WEST')`); a nested UTC-aware destination switched it to UTC and
  restored it on exit. Under `TZ=America/Los_Angeles`, naive `datetime(2026, 1, 1, 12)` travelled
  to 12:00Z and the string `"2026-01-01 12:00"` to 20:00Z. `@pytest.mark.time_machine(...,
  tick=False)` as a module `pytestmark` works.
- freezegun 1.5.5: `time.monotonic()` and `time.perf_counter()` frozen, `tick(5)` advanced
  monotonic by 5.0; with `TZ=America/Los_Angeles`, `freeze_time("2026-01-01 12:00")` gave naive
  `now()` 12:00 and `now(UTC)` 12:00Z; `asyncio.run(asyncio.sleep(0.01))` hung inside `freeze_time`
  and returned with `real_asyncio=True`.
- `PYTHONHASHSEED=1/2/3` gave three different iteration orders for the same set of four strings.
- `pytest.approx([{"k": 1}])` raises `TypeError: pytest.approx() does not support nested data
  structures` on 9.2.0.
- `1000.0 + 4.5e-14 == 1000.0` is `True`: a token-bucket loop driven by a manual clock starting at
  1000.0 that sleeps "the remaining fraction" never reached a full token.
- The `python:3.14-slim` image has `/usr/share/zoneinfo`; `TZ=Pacific/Auckland` and POSIX `TZ`
  strings both work there.
