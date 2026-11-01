"""Run the collected tests in reverse order (the opposite of file order)."""

import pytest


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(items):
    items.reverse()
