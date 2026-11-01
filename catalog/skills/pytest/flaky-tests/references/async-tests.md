# Async tests with pytest 9 and pytest-asyncio 1.x

Checked against pytest 9.2.0 and pytest-asyncio 1.4.1 on Python 3.14. Error texts are quoted from
those versions.

## Errors and what they mean now

| Message | Cause | Fix |
| --- | --- | --- |
| `async def functions are not natively supported.` (test **fails**, pytest 8.4+) | an `async def` test that no plugin runs: missing `@pytest.mark.asyncio` in strict mode, or no plugin installed | add the marker, or `asyncio_mode = "auto"` |
| `'test_x' requested an async fixture 'conn', with no plugin or hook that handled it. This is an error, as pytest does not natively support it.` | async fixture decorated with `@pytest.fixture` in strict mode, or an async fixture requested by a sync test (an error since pytest 9.0) | `@pytest_asyncio.fixture`, and request it from async tests |
| `fixture 'event_loop' not found` | pytest-asyncio 1.0 removed the `event_loop` fixture | `asyncio.get_running_loop()` inside the test |
| `Task ... got Future <Future pending> attached to a different loop` | a future or callback created on a loop other than the one running the test, typically from a home-made `event_loop` fixture | create futures with `asyncio.get_running_loop().create_future()` |
| `The configuration option "asyncio_default_fixture_loop_scope" is unset.` (PytestDeprecationWarning) | the option will default to function scope in a future release | set `asyncio_default_fixture_loop_scope = "function"` |
| `PytestReturnNotNoneWarning: Test functions should return None, but ... returned <class 'bool'>` (the test **passes**) | `return result == expected` instead of `assert`; 8.4.0 made this a failure by accident and 8.4.1 restored the warning | `assert` it; consider `filterwarnings = ["error::pytest.PytestReturnNotNoneWarning"]` |

Reproduced on 1.4.1: re-adding the pre-1.0 recipe

```python
@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
```

makes `event_loop.create_future()` plus `event_loop.call_soon(fut.set_result, 7)` fail with
"attached to a different loop": the test body runs in pytest-asyncio's own runner loop, and your
loop never runs at all. Callbacks scheduled on it never fire.

## Configuration

```toml
[tool.pytest.ini_options]
asyncio_mode = "strict"                         # default; "auto" treats every async test/fixture as asyncio
asyncio_default_fixture_loop_scope = "function"
asyncio_default_test_loop_scope = "function"
```

- Shared loops: `@pytest.mark.asyncio(loop_scope="module")` on tests and
  `@pytest_asyncio.fixture(loop_scope="module")` on fixtures that must live on the same loop (for
  example a module-scoped client).
- Custom loops (uvloop, debug loops): the `pytest_asyncio_loop_factories` hook (1.4.0); overriding
  `event_loop_policy` is deprecated in 1.4.
- `--asyncio-debug` (1.2+) turns on asyncio debug mode for the default loop (slow-callback
  logging, and the creation traceback in "never awaited" warnings).
- anyio's pytest plugin (`@pytest.mark.anyio`) is an alternative runner; don't mark the same test for
  both.

## Hollow async tests

These pass while checking nothing. Each was reproduced on pytest 9.2.0 + pytest-asyncio 1.4.1.

```python
def test_send_returns_receipt():            # sync test, async code
    assert send_invoice(order)              # coroutine object: always truthy

@pytest.mark.asyncio
async def test_rejects_bad_payload():
    expect_rejected(payload)                # async helper, never awaited: its asserts never run

@pytest.mark.asyncio
async def test_background_check():
    asyncio.create_task(verify_totals())    # failure only logged: "Task exception was never retrieved"
```

The first two emit `RuntimeWarning: coroutine '...' was never awaited` in the warnings summary and
still pass. `-W error::RuntimeWarning` alone does not change that: the warning is raised while the
coroutine is finalized, which pytest turns into `PytestUnraisableExceptionWarning`. Fail on both:

```toml
[tool.pytest.ini_options]
filterwarnings = ["error::RuntimeWarning", "error::pytest.PytestUnraisableExceptionWarning"]
```

With that configuration both tests above fail. The `create_task` one still passes; only reading it
finds it. Grep for suspects:

```sh
rg -n "^\s+(assert\s+)?[a-z_]+\(.*\)\s*$" tests | rg -v "await|assert .* ==" | head   # bare calls
rg -n "create_task\(|ensure_future\(" tests
```

## Replacing real time in async code

- Inject `sleep` (and the clock it implies) and record calls; await a fake that advances the clock
  and yields with `await asyncio.sleep(0)`.
- Prefer events to sleeps for synchronisation: `asyncio.Event`, `asyncio.Queue.join()`,
  `asyncio.wait_for(event.wait(), timeout=1)` or `async with asyncio.timeout(1):` as a guard
  against hangs, never as the synchronisation itself.
- `AsyncMock` records awaits: `sleep.await_args_list`, `assert_awaited_once_with(0.5)`. If the code
  re-reads a clock after sleeping, give it `side_effect=` that advances that clock, or it spins.
- Do not freeze `time.monotonic()` globally in async tests (freezegun without `real_asyncio=True`,
  or `monkeypatch.setattr(time, "monotonic", ...)`): the loop's timers stop firing and real
  `asyncio.sleep()` calls hang. Reproduced: `asyncio.run(asyncio.sleep(0.01))` inside
  `freeze_time(...)` never returned, and returned at once with `real_asyncio=True`.
- time-machine never touches `time.monotonic()`, so it is safe for the loop, and useless for code
  that measures intervals with it.
