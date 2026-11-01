"""Async token bucket that paces outgoing webhook deliveries per destination."""

import asyncio
import time
from collections.abc import Awaitable, Callable

# Refill arithmetic is floating point; treat "a hair under one token" as one token.
_EPSILON = 1e-9


class TokenBucket:
    """Allows bursts of `capacity` calls, refilling at `rate` tokens per second.

    `clock` (monotonic seconds) and `sleep` (an async sleep) default to time.monotonic and
    asyncio.sleep.
    """

    def __init__(
        self,
        rate: float,
        capacity: int,
        *,
        clock: Callable[[], float] | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        if rate <= 0 or capacity < 1:
            raise ValueError("rate must be positive and capacity at least 1")
        self._rate = rate
        self._capacity = capacity
        self._clock = clock if clock is not None else time.monotonic
        self._sleep = sleep if sleep is not None else asyncio.sleep
        self._tokens = float(capacity)
        self._updated = self._clock()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self._capacity, self._tokens + (now - self._updated) * self._rate)
        self._updated = now

    def try_acquire(self) -> bool:
        self._refill()
        if self._tokens >= 1 - _EPSILON:
            self._tokens -= 1
            return True
        return False

    async def acquire(self) -> None:
        """Wait until a token is available, then take it. Waiters are served in arrival order."""
        async with self._lock:
            self._refill()
            self._tokens -= 1
