import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

SECRET = "whsec_test_4f1c"


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def event(**overrides) -> dict:
    data = {
        "id": "evt_9fK2mQ7xLp",
        "type": "payment.succeeded",
        "order_id": "ord_1042",
        "amount_cents": 4599,
        "currency": "EUR",
        "created": "2026-10-27T09:14:03Z",
    }
    data.update(overrides)
    return data


def encode(data: dict) -> bytes:
    return json.dumps(data, separators=(",", ":")).encode()


@pytest.fixture
def app():
    return create_app(Settings(acme_webhook_secret=SECRET))


@pytest.fixture
def client(app):
    return TestClient(app)
