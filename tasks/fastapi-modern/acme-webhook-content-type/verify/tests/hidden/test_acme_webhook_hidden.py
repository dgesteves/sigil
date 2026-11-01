import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

SECRET = "whsec_verify_77a0"


def sign(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


CAPTURED = (
    b'{"id":"evt_9fK2mQ7xLp","type":"payment.succeeded","order_id":"ord_1042",'
    b'"amount_cents":4599,"currency":"EUR","created":"2026-10-27T09:14:03Z"}'
)


@pytest.fixture
def app():
    return create_app(Settings(acme_webhook_secret=SECRET))


@pytest.fixture
def client(app):
    return TestClient(app)


def acme_post(client, body: bytes, signature: str | None = None):
    """Exactly what Acme's sender does: no Content-Type header at all."""
    headers = {"x-acme-signature": signature or sign(body), "user-agent": "AcmePay-Webhooks/4.2"}
    request = client.build_request("POST", "/webhooks/acme-pay", content=body, headers=headers)
    assert "content-type" not in request.headers
    return client.send(request)


def test_captured_delivery_without_content_type_is_accepted(client, app):
    r = acme_post(client, CAPTURED)
    assert r.status_code == 200, r.text
    assert r.json() == {"received": "evt_9fK2mQ7xLp"}
    stored = app.state.ledger["evt_9fK2mQ7xLp"]
    assert stored.amount_cents == 4599
    assert stored.order_id == "ord_1042"


def test_redelivery_without_content_type_is_idempotent(client, app):
    assert acme_post(client, CAPTURED).status_code == 200
    assert acme_post(client, CAPTURED).status_code == 200
    assert list(app.state.ledger) == ["evt_9fK2mQ7xLp"]


def test_deliveries_with_a_json_content_type_still_work(client, app):
    body = json.dumps({**json.loads(CAPTURED), "id": "evt_withHeader01"}).encode()
    r = client.post(
        "/webhooks/acme-pay",
        content=body,
        headers={"content-type": "application/json", "x-acme-signature": sign(body)},
    )
    assert r.status_code == 200
    assert "evt_withHeader01" in app.state.ledger


def test_signature_is_still_checked_without_content_type(client, app):
    r = acme_post(client, CAPTURED, signature=sign(CAPTURED, "forged"))
    assert r.status_code == 401
    assert app.state.ledger == {}


@pytest.mark.parametrize(
    ("change", "loc"),
    [
        ({"amount_cents": -5}, ["body", "amount_cents"]),
        ({"currency": "eur"}, ["body", "currency"]),
        ({"created": "2026-10-27T09:14:03"}, ["body", "created"]),
        ({"type": "payment.disputed"}, ["body", "type"]),
    ],
)
def test_events_are_still_validated_without_content_type(client, app, change, loc):
    body = json.dumps({**json.loads(CAPTURED), **change}).encode()
    r = acme_post(client, body)
    assert r.status_code == 422
    assert loc in [error["loc"] for error in r.json()["detail"]]
    assert app.state.ledger == {}


def test_malformed_json_without_content_type_is_rejected(client, app):
    r = acme_post(client, b'{"id": "evt_9fK2mQ7xLp",')
    assert 400 <= r.status_code < 500
    assert app.state.ledger == {}


def test_other_json_endpoints_still_require_a_json_content_type(client, app):
    body = json.dumps({"order_id": "ord_7", "amount_cents": 990, "currency": "EUR"}).encode()
    no_header = client.build_request("POST", "/checkouts", content=body)
    assert "content-type" not in no_header.headers
    assert client.send(no_header).status_code == 422
    text_plain = client.post("/checkouts", content=body, headers={"content-type": "text/plain"})
    assert text_plain.status_code == 422
    assert app.state.checkouts == {}
    ok = client.post("/checkouts", content=body, headers={"content-type": "application/json"})
    assert ok.status_code == 201


def resolve(spec: dict, schema: dict) -> dict:
    ref = schema.get("$ref")
    if ref:
        assert ref.startswith("#/components/schemas/")
        return spec["components"]["schemas"][ref.rsplit("/", 1)[1]]
    return schema


def test_the_webhook_body_is_still_documented_in_openapi(client):
    spec = client.get("/openapi.json").json()
    operation = spec["paths"]["/webhooks/acme-pay"]["post"]
    body = operation["requestBody"]
    assert body.get("required") is True
    schema = resolve(spec, body["content"]["application/json"]["schema"])
    assert set(schema["properties"]) == {"id", "type", "order_id", "amount_cents", "currency", "created"}
    assert set(schema["required"]) == {"id", "type", "order_id", "amount_cents", "currency", "created"}
    assert schema["properties"]["amount_cents"].get("minimum") == 0
    headers = [p["name"].lower() for p in operation.get("parameters", []) if p["in"] == "header"]
    assert "x-acme-signature" in headers
