import time

import pytest

from relaykit.ratelimit import TokenBucket


@pytest.mark.asyncio
async def test_burst_up_to_capacity_does_not_wait():
    bucket = TokenBucket(rate=10, capacity=3)
    started = time.monotonic()
    for _ in range(3):
        await bucket.acquire()
    assert time.monotonic() - started < 0.01


@pytest.mark.asyncio
async def test_acquire_waits_for_the_next_token():
    bucket = TokenBucket(rate=20, capacity=1)
    await bucket.acquire()
    started = time.monotonic()
    await bucket.acquire()
    assert 0.045 <= time.monotonic() - started <= 0.07


def test_try_acquire_refuses_when_empty():
    bucket = TokenBucket(rate=1, capacity=1)
    assert bucket.try_acquire()
    assert not bucket.try_acquire()
