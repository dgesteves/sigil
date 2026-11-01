"""Emulate a busy CI runner: every real sleep is followed by a long stall.

Sleeping is only ever a lower bound on how long a process waits. Here `time.sleep(s)` and
`asyncio.sleep(s)` for s > 0 return at once, but the monotonic, performance and wall clocks jump
forward by s plus FLAKY_STALL seconds, as if the machine had paused the process. A test that waits
for real time and then asserts on what the clock or the code under test says will see the stall; a
test that drives its own clock or sleep does not. The event loop keeps its real clock, so asyncio
timeouts in the tests behave normally.
"""

import asyncio
import asyncio.base_events
import os
import time

STALL = float(os.environ.get("FLAKY_STALL", "0"))
_offset = 0.0
_real_monotonic = time.monotonic
_real_perf_counter = time.perf_counter
_real_time = time.time
_real_asyncio_sleep = asyncio.sleep


def _stall(seconds):
    global _offset
    _offset += seconds + STALL


def monotonic():
    return _real_monotonic() + _offset


def perf_counter():
    return _real_perf_counter() + _offset


def wall_time():
    return _real_time() + _offset


def sleep(seconds):
    if seconds > 0:
        _stall(seconds)


async def asyncio_sleep(delay, result=None):
    if delay > 0:
        _stall(delay)
    return await _real_asyncio_sleep(0, result)


def pytest_configure(config):
    if not STALL:
        return
    time.monotonic = monotonic
    time.perf_counter = perf_counter
    time.time = wall_time
    time.sleep = sleep
    asyncio.sleep = asyncio_sleep
    # The loop schedules its own timers with the real clock.
    asyncio.base_events.BaseEventLoop.time = lambda self: _real_monotonic()
