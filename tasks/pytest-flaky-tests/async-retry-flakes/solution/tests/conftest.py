import asyncio

import pytest


class FakeTime:
    """A manual monotonic clock plus an async sleep that advances it instead of waiting."""

    def __init__(self, start: float = 1_000.0) -> None:
        self.now = start
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds
        await asyncio.sleep(0)  # still yield to the event loop, like a real sleep


class CapJitter:
    """Deterministic stand-in for `random`: always waits the full cap."""

    def uniform(self, low: float, high: float) -> float:
        return high


@pytest.fixture
def fake_time() -> FakeTime:
    return FakeTime()


@pytest.fixture
def cap_jitter() -> CapJitter:
    return CapJitter()
