"""Start the whole test session at the instant given in FLAKY_NOW (ISO 8601, UTC), clock ticking.

The destination is passed as a POSIX timestamp so time-machine leaves the process timezone (the TZ
environment variable) alone. Tests that travel or inject their own clock are unaffected.
"""

import os
from datetime import datetime

import pytest
import time_machine

_traveller = None


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    global _traveller
    instant = os.environ.get("FLAKY_NOW")
    if instant:
        _traveller = time_machine.travel(datetime.fromisoformat(instant).timestamp(), tick=True)
        _traveller.start()


def pytest_unconfigure(config):
    if _traveller is not None:
        _traveller.stop()
