# Shared state, test order and isolation

Checked against pytest 9.2.0 and pytest-randomly 5.0.0 on Python 3.14.

## How pytest-randomly orders and seeds

- Installed means enabled. It shuffles modules, then classes, then functions, and prints
  `Using --randomly-seed=N` in the header.
- `--randomly-seed=N` reproduces an order; `--randomly-seed=last` reuses the previous run's seed and
  needs the cache provider (it does nothing useful with `-p no:cacheprovider`).
- `-p no:randomly` disables it entirely (file order). `--randomly-dont-reorganize` keeps file order
  but still reseeds; `--randomly-dont-reset-seed` keeps shuffling but stops reseeding `random`.
- Before each test's setup, call and teardown it calls `random.seed()` with a value derived from the
  base seed and the test id (per-test seeds since 4.0). Faker, factory_boy, Model Bakery, NumPy's
  legacy global RNG and Polyfactory's default generator are reset too.
- 5.0.0 shuffles inside a hook wrapper that runs before every other plugin's
  `pytest_collection_modifyitems`. Before 5.0 the relative order of plugins depended on installation
  metadata, so the same seed could give different orders on two machines, and plugins that group
  tests (pytest-django) could have their grouping destroyed. After upgrading, a given seed may
  produce a different order than before.

Reverse order (`items.reverse()` in a tiny local plugin) finds fewer dependencies than random order
but is cheap and deterministic; running each test alone finds the "only passes after X" kind.

## Where shared state hides

| Source | Symptom | Fix |
| --- | --- | --- |
| `os.environ` written in a test | later tests see the value | `monkeypatch.setenv` / `delenv(raising=False)` |
| env read through `functools.cache` / `lru_cache` | changing the env var has no effect, or a stale value survives | clear the cache before and after each test (`fn.cache_clear()`) |
| "load once" module globals | later tests see an earlier test's data file | call the module's reset, or `monkeypatch.setattr(module, "_loaded", None)` |
| registries, overrides, singletons, class attributes | a value set in one test is still set in the next | reset in an autouse fixture |
| files at a fixed path, or in the repo | tests overwrite each other; parallel runs collide | `tmp_path` (function scope) or `tmp_path_factory` (shared) |
| current directory | relative paths resolve differently | `monkeypatch.chdir(tmp_path)` |
| logging handlers, warnings filters | duplicated or missing log records | `caplog`; `recwarn` / `pytest.warns` |
| higher-scoped fixtures | mutating a shared object leaks into other tests | return copies, or use function scope for mutable data |
| import-time side effects | state exists before any fixture runs | reset in the fixture *before* yielding, not only after |

Things that look like isolation but are not:

- `try: ... finally: del os.environ["X"]` restores the variable but not the cache that already read
  it. The next test gets the cached value.
- `cache_clear()` at the start of one test only: the test after it inherits whatever it cached.
- A helper function that sets env vars and clears caches: the env var still leaks after the test.
- `monkeypatch` used at module level or inside a helper called from a module-level statement:
  it is a fixture; outside a test use `with pytest.MonkeyPatch.context() as mp:`.

## Fixture design

```python
@pytest.fixture(autouse=True)
def isolated_reports(monkeypatch):
    monkeypatch.delenv("REPORTS_DIR", raising=False)
    reports.registry.clear()
    report_settings.cache_clear()
    yield
    reports.registry.clear()
    report_settings.cache_clear()
```

- Put cross-cutting resets in `conftest.py` as `autouse=True` so no test can forget them; put data
  setup in explicit fixtures (`report_file`, `user`) that tests request by name.
- Delete every variable the code reads, not only the ones tests set: developer shells and CI export
  different things.
- A fixture that writes a file should also point the code at it (env var or argument) and clear any
  cache that remembers the old path.
- pytest 9.1 deprecates class-scoped fixtures defined as instance methods, and 9.2 extends that to
  module, package and session scope: such fixtures set attributes on a different instance than the
  test sees. Use `@classmethod` or a plain function.
- pytest 9.2 makes `indirect`, `ids` and `scope` keyword-only in `parametrize`.
- Non-`Collection` iterables (generators) as `argvalues` are deprecated since 9.1: they are consumed
  once and later collections silently get no tests. Use a list or tuple.

## pytest-xdist

Tests that pass serially but fail with `-n auto` almost always share a resource: a fixed file
path, a port, a database name, a cache directory. `tmp_path` is per test and per worker. For shared
setup across workers use `tmp_path_factory.getbasetemp().parent` plus a file lock, or give each
worker its own resource keyed by the `worker_id` fixture.
