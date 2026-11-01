"""In-memory cache whose entries expire a fixed time after they are written."""

import time
from collections.abc import Callable, Hashable
from typing import Any


class TTLCache:
    """Entries expire `ttl` seconds after `set()`.

    `clock` is any monotonic seconds counter; it defaults to time.monotonic.
    """

    def __init__(self, ttl: float, *, clock: Callable[[], float] | None = None) -> None:
        if ttl <= 0:
            raise ValueError("ttl must be positive")
        self._ttl = ttl
        self._clock = clock if clock is not None else time.monotonic
        self._entries: dict[Hashable, tuple[Any, float]] = {}

    def set(self, key: Hashable, value: Any) -> None:
        self._entries[key] = (value, self._clock() + self._ttl)

    def get(self, key: Hashable, default: Any = None) -> Any:
        entry = self._entries.get(key)
        if entry is None:
            return default
        value, expires_at = entry
        if self._clock() >= expires_at:
            del self._entries[key]
            return default
        return value

    def __len__(self) -> int:
        return len(self._entries)
