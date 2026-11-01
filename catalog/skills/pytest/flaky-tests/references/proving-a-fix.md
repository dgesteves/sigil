# Proving a flaky test is fixed

"It passed three times" proves little: most flakes need a particular order, instant or load. Make
the bad condition happen on purpose, before and after the fix.

## 1. Reproduce

| Suspect | Reproduce with |
| --- | --- |
| order | the seed from the CI log: `python -m pytest -p randomly --randomly-seed=N`; then the failing test alone; then `-p no:randomly` |
| state left by one specific test | bisect: run the failing test after halves of the suite (`pytest tests/test_a.py tests/test_b.py::test_failing`) |
| date / time of day | a session-level time travel (below) at the instant CI failed |
| timezone | `TZ=Pacific/Auckland python -m pytest`, `TZ=America/Los_Angeles python -m pytest` |
| hash ordering | `PYTHONHASHSEED=0`, `1`, `2`, ... (set before Python starts) |
| load / real time | look for `sleep(`, `monotonic()`, `perf_counter()`, `elapsed` in the test; a loop of runs under `stress` or with other CPU work is only a rough check |
| hollow async test | `-W error::RuntimeWarning -W error::pytest.PytestUnraisableExceptionWarning` |

## 2. A session clock plugin for edge instants

Run the whole suite as if it were another moment, without editing tests. Tests that inject their
own clock or travel themselves are unaffected (time-machine travels nest). Passing a POSIX
timestamp keeps the `TZ` environment variable in effect, so the instant and the zone can be varied
independently.

```python
# session_clock.py, somewhere on PYTHONPATH; run with: python -m pytest -p session_clock
import os
from datetime import datetime

import pytest
import time_machine

_trip = None


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    global _trip
    if instant := os.environ.get("SUITE_NOW"):          # e.g. 2027-01-30T12:00:00+00:00
        _trip = time_machine.travel(datetime.fromisoformat(instant).timestamp(), tick=True)
        _trip.start()


def pytest_unconfigure(config):
    if _trip is not None:
        _trip.stop()
```

```sh
for spec in "2026-12-15T12:00:00+00:00 UTC" "2027-01-30T12:00:00+00:00 UTC" \
            "2028-02-29T12:00:00+00:00 UTC" "2026-07-15T22:30:00+00:00 Pacific/Auckland" \
            "2026-07-16T03:00:00+00:00 America/Los_Angeles" "2026-10-24T08:30:00+00:00 Europe/Lisbon"; do
  set -- $spec
  SUITE_NOW=$1 TZ=$2 PYTHONPATH=. python -m pytest -q -p session_clock || echo "FAILS at $1 in $2"
done
```

## 3. Repeat under many orders and alone

```sh
for s in $(seq 1 10); do
  PYTHONHASHSEED=$s python -m pytest -q -p randomly --randomly-seed=$s >/dev/null || echo "seed $s fails"
done
python -m pytest --collect-only -q -p no:randomly | grep '::' | sed 's/\[.*//' | sort -u \
  | while read -r t; do python -m pytest -q -p no:randomly "$t" >/dev/null || echo "alone: $t"; done
```

Each run is a separate process, so module state can't hide between runs. If tests share files,
run them with a private `TMPDIR` too.

## 4. Check the tests still test something

A fix that makes a test pass by checking less is not a fix. For each test you changed:

1. Break the code in the way the test claims to catch: remove a clamp, invert a comparison, drop
   the last retry, ignore an override, expire immediately, never expire.
2. Run the test: it must fail with an assertion, not an import or collection error.
3. Revert.

`git stash`-style manual mutation is enough for a handful of tests; for many, a mutation tool
(mutmut, cosmic-ray) automates it. Also check the pass count did not drop: compare
`pytest --collect-only -q | tail -1` before and after.

## 5. What not to merge as the fix

- reruns (`pytest-rerunfailures`, `@pytest.mark.flaky`), loops that retry an assertion;
- longer sleeps, larger TTLs or wider bounds around real time;
- `skip`, `xfail` (strict or not) without a tracked issue;
- `-p no:randomly` or `--randomly-dont-reorganize` in `addopts`;
- `filterwarnings = ignore::RuntimeWarning` to hide "never awaited";
- an expected value computed with the code under test.
