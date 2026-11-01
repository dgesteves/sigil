import json

import pytest

from flagship import clear_overrides, store
from flagship.settings import get_settings

FLAGSHIP_VARS = ("FLAGSHIP_FILE", "FLAGSHIP_DEFAULT_ON", "FLAGSHIP_ENV")


def _reset_process_state():
    get_settings.cache_clear()
    store.reload()
    clear_overrides()


@pytest.fixture(autouse=True)
def isolated_flagship(monkeypatch):
    """Every test starts from the documented defaults and leaves nothing behind.

    flagship keeps three pieces of process-wide state: the cached settings, the loaded flags file and
    the overrides. Environment changes go through monkeypatch so they are undone after each test.
    """
    for name in FLAGSHIP_VARS:
        monkeypatch.delenv(name, raising=False)
    _reset_process_state()
    yield
    _reset_process_state()


@pytest.fixture
def use_flags(tmp_path, monkeypatch):
    """Point flagship at a private flags file for this test."""

    def write(definitions, **env):
        path = tmp_path / "flags.json"
        path.write_text(json.dumps(definitions))
        monkeypatch.setenv("FLAGSHIP_FILE", str(path))
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()
        store.reload()

    return write
