import asyncio
import random
from datetime import UTC, datetime

import pytest

from relaykit.retry import retry_after_seconds, retry_async


class Endpoint:
    """Fake webhook endpoint: raises or returns the scripted outcomes in order."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


@pytest.mark.asyncio
async def test_returns_the_response_once_the_endpoint_recovers(fake_time):
    loop = asyncio.get_running_loop()
    outcomes = [ConnectionError("reset by peer"), TimeoutError(), "202 Accepted"]

    async def deliver():
        # simulate network latency: the response arrives on a later loop iteration
        response = loop.create_future()
        outcome = outcomes.pop(0)
        if isinstance(outcome, BaseException):
            loop.call_soon(response.set_exception, outcome)
        else:
            loop.call_soon(response.set_result, outcome)
        return await response

    assert await retry_async(deliver, base_delay=0.001, sleep=fake_time.sleep) == "202 Accepted"
    assert outcomes == []


@pytest.mark.asyncio
async def test_first_success_is_returned_without_retrying(fake_time):
    endpoint = Endpoint("200 OK", "200 OK")
    assert await retry_async(endpoint, sleep=fake_time.sleep) == "200 OK"
    assert endpoint.calls == 1
    assert fake_time.sleeps == []


@pytest.mark.asyncio
async def test_gives_up_after_the_last_attempt(fake_time, cap_jitter):
    endpoint = Endpoint(*[ConnectionError("connection refused")] * 3)
    with pytest.raises(ConnectionError):
        await retry_async(
            endpoint, attempts=3, base_delay=0.01, sleep=fake_time.sleep, rng=cap_jitter
        )
    assert endpoint.calls == 3
    assert fake_time.sleeps == pytest.approx([0.01, 0.02])


@pytest.mark.asyncio
async def test_backoff_doubles_and_is_capped(fake_time, cap_jitter):
    endpoint = Endpoint(*[TimeoutError()] * 6)
    with pytest.raises(TimeoutError):
        await retry_async(
            endpoint,
            attempts=6,
            base_delay=0.01,
            max_delay=0.02,
            sleep=fake_time.sleep,
            rng=cap_jitter,
        )
    assert fake_time.sleeps == pytest.approx([0.01, 0.02, 0.02, 0.02, 0.02])


@pytest.mark.asyncio
async def test_each_wait_is_between_half_the_cap_and_the_cap(fake_time):
    endpoint = Endpoint(*[TimeoutError()] * 6)
    with pytest.raises(TimeoutError):
        await retry_async(
            endpoint,
            attempts=6,
            base_delay=0.01,
            max_delay=0.02,
            sleep=fake_time.sleep,
            rng=random.Random(20261101),
        )
    caps = [0.01, 0.02, 0.02, 0.02, 0.02]
    assert all(cap / 2 <= wait <= cap for wait, cap in zip(fake_time.sleeps, caps, strict=True))


async def expect_a_single_attempt(endpoint, error, sleep):
    with pytest.raises(error):
        await retry_async(endpoint, base_delay=0.001, sleep=sleep)
    assert endpoint.calls == 1


@pytest.mark.asyncio
async def test_client_errors_are_not_retried(fake_time):
    endpoint = Endpoint(ValueError("400 Bad Request: unknown event type"), "200 OK")
    await expect_a_single_attempt(endpoint, ValueError, fake_time.sleep)


def test_retry_after_in_seconds():
    assert retry_after_seconds("120") == 120.0


def test_retry_after_as_http_date(time_machine):
    time_machine.move_to(datetime(2026, 11, 2, 12, 0, tzinfo=UTC), tick=False)
    assert retry_after_seconds("Mon, 02 Nov 2026 12:00:30 GMT") == 30.0
    assert retry_after_seconds("Mon, 02 Nov 2026 11:59:00 GMT") == 0.0
