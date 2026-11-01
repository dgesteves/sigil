import pytest

from relaykit.ratelimit import TokenBucket


@pytest.mark.asyncio
async def test_burst_up_to_capacity_does_not_wait(fake_time):
    bucket = TokenBucket(rate=10, capacity=3, clock=fake_time.monotonic, sleep=fake_time.sleep)
    for _ in range(3):
        await bucket.acquire()
    assert fake_time.sleeps == []


@pytest.mark.asyncio
async def test_acquire_waits_for_the_next_token(fake_time):
    bucket = TokenBucket(rate=20, capacity=1, clock=fake_time.monotonic, sleep=fake_time.sleep)
    await bucket.acquire()
    await bucket.acquire()
    assert fake_time.sleeps == [pytest.approx(0.05)]


def test_try_acquire_refuses_when_empty(fake_time):
    bucket = TokenBucket(rate=1, capacity=1, clock=fake_time.monotonic)
    assert bucket.try_acquire()
    assert not bucket.try_acquire()
    fake_time.advance(1)
    assert bucket.try_acquire()
