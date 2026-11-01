from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def app(tmp_path) -> FastAPI:
    return create_app(tmp_path / "orders.db")


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


ORDER = {"customer": "Ines Duarte", "lines": [{"sku": "SOURDOUGH", "quantity": 2}]}
