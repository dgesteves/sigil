from conftest import encode, event, sign


def test_start_checkout(client):
    r = client.post("/checkouts", json={"order_id": "ord_1", "amount_cents": 1200, "currency": "EUR"})
    assert r.status_code == 201
    assert r.json() == {"checkout_id": "chk_000001", "order_id": "ord_1", "status": "pending"}


def test_checkout_validation(client):
    r = client.post("/checkouts", json={"order_id": "ord_1", "amount_cents": 0, "currency": "EUR"})
    assert r.status_code == 422


def test_webhook_with_json_content_type(client, app):
    body = encode(event())
    r = client.post(
        "/webhooks/acme-pay",
        content=body,
        headers={"content-type": "application/json", "x-acme-signature": sign(body)},
    )
    assert r.status_code == 200
    assert r.json() == {"received": "evt_9fK2mQ7xLp"}
    assert list(app.state.ledger) == ["evt_9fK2mQ7xLp"]


def test_webhook_rejects_a_bad_signature(client, app):
    body = encode(event())
    r = client.post(
        "/webhooks/acme-pay",
        content=body,
        headers={"content-type": "application/json", "x-acme-signature": sign(body, "other")},
    )
    assert r.status_code == 401
    assert app.state.ledger == {}


def test_webhook_redelivery_is_idempotent(client, app):
    body = encode(event())
    headers = {"content-type": "application/json", "x-acme-signature": sign(body)}
    assert client.post("/webhooks/acme-pay", content=body, headers=headers).status_code == 200
    assert client.post("/webhooks/acme-pay", content=body, headers=headers).status_code == 200
    assert len(app.state.ledger) == 1
