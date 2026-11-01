"""Retries with capped exponential backoff and jitter, plus Retry-After parsing."""

import asyncio
import random
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Protocol


class Jitter(Protocol):
    def uniform(self, a: float, b: float) -> float: ...


RETRYABLE: tuple[type[BaseException], ...] = (ConnectionError, TimeoutError)


async def retry_async[T](
    call: Callable[[], Awaitable[T]],
    *,
    attempts: int = 4,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
    retry_on: tuple[type[BaseException], ...] = RETRYABLE,
    sleep: Callable[[float], Awaitable[None]] | None = None,
    rng: Jitter | None = None,
) -> T:
    """Call `call()` up to `attempts` times, retrying only on `retry_on` exceptions.

    Before retry n (1-based) it sleeps a random duration in [cap / 2, cap], where
    cap = min(max_delay, base_delay * 2 ** (n - 1)). The last exception is re-raised when every
    attempt fails. `sleep` defaults to asyncio.sleep and `rng` to the `random` module.
    """
    sleep = sleep if sleep is not None else asyncio.sleep
    rng = rng if rng is not None else random
    for attempt in range(1, attempts + 1):
        try:
            return await call()
        except retry_on:
            if attempt == attempts:
                raise
            cap = min(max_delay, base_delay * 2 ** (attempt - 1))
            await sleep(rng.uniform(cap / 2, cap))
    raise AssertionError("unreachable")


def retry_after_seconds(header: str, now: datetime | None = None) -> float:
    """Seconds to wait for a Retry-After header: delta-seconds or an HTTP-date. Never negative."""
    header = header.strip()
    if header.isdigit():
        return float(header)
    when = parsedate_to_datetime(header)
    now = datetime.now(UTC) if now is None else now
    return max(0.0, (when - now).total_seconds())
