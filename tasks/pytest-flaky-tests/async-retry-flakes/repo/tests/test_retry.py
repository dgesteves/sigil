import time
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
async def test_returns_the_response_once_the_endpoint_recovers(event_loop):
    outcomes = [ConnectionError("reset by peer"), TimeoutError(), "202 Accepted"]

    async def deliver():
        # simulate network latency: the response arrives on a later loop iteration
        response = event_loop.create_future()
        outcome = outcomes.pop(0)
        if isinstance(outcome, BaseException):
            event_loop.call_soon(response.set_exception, outcome)
        else:
            event_loop.call_soon(response.set_result, outcome)
        return await response

    assert await retry_async(deliver, base_delay=0.001) == "202 Accepted"
    assert outcomes == []


def test_first_success_is_returned_without_retrying():
    endpoint = Endpoint("200 OK", "200 OK")
    assert retry_async(endpoint)


@pytest.mark.asyncio
async def test_gives_up_after_the_last_attempt():
    endpoint = Endpoint(*[ConnectionError("connection refused")] * 3)
    started = time.monotonic()
    with pytest.raises(ConnectionError):
        await retry_async(endpoint, attempts=3, base_delay=0.01)
    assert endpoint.calls == 3
    assert time.monotonic() - started < 0.1


@pytest.mark.asyncio
async def test_backoff_doubles_and_is_capped():
    attempted_at = []

    async def deliver():
        attempted_at.append(time.monotonic())
        raise TimeoutError()

    with pytest.raises(TimeoutError):
        await retry_async(deliver, attempts=6, base_delay=0.01, max_delay=0.02)
    gaps = [later - earlier for earlier, later in zip(attempted_at, attempted_at[1:])]
    # caps are 0.01, 0.02, 0.02, 0.02, 0.02 and each wait is between cap / 2 and cap
    assert 0.005 <= gaps[0] <= 0.015
    assert all(0.01 <= gap <= 0.03 for gap in gaps[1:])


async def expect_a_single_attempt(endpoint, error):
    with pytest.raises(error):
        await retry_async(endpoint, base_delay=0.001)
    assert endpoint.calls == 1


@pytest.mark.asyncio
async def test_client_errors_are_not_retried():
    endpoint = Endpoint(ValueError("400 Bad Request: unknown event type"), "200 OK")
    expect_a_single_attempt(endpoint, ValueError)


def test_retry_after_in_seconds():
    assert retry_after_seconds("120") == 120.0


def test_retry_after_as_http_date(time_machine):
    time_machine.move_to(datetime(2026, 11, 2, 12, 0, tzinfo=UTC), tick=False)
    assert retry_after_seconds("Mon, 02 Nov 2026 12:00:30 GMT") == 30.0
    assert retry_after_seconds("Mon, 02 Nov 2026 11:59:00 GMT") == 0.0
