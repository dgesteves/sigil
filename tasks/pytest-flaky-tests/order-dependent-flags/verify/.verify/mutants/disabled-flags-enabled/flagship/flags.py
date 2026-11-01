"""Flag evaluation: overrides first, then the flags file, then the default."""

import zlib

from flagship import store
from flagship.settings import get_settings

_overrides: dict[str, bool] = {}


def override(name: str, value: bool) -> None:
    """Force a flag on or off in this process (used by ops tooling and the admin console)."""
    _overrides[name] = value


def clear_overrides() -> None:
    _overrides.clear()


def bucket(name: str, user_id: str) -> int:
    """Stable 0-99 bucket for a user and flag, so a rollout keeps the same users enabled."""
    return zlib.crc32(f"{name}:{user_id}".encode()) % 100


def is_enabled(name: str, user_id: str | None = None) -> bool:
    if name in _overrides:
        return _overrides[name]
    definition = store.definitions().get(name)
    if definition is None:
        return get_settings().default_on
    environments = definition.get("environments")
    if environments is not None and get_settings().environment not in environments:
        return False
    rollout = definition.get("rollout", 100)
    if rollout >= 100:
        return True
    if user_id is None:
        return False
    return bucket(name, user_id) < rollout
