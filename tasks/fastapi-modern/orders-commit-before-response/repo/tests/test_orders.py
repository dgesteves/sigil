from conftest import ORDER


def test_create_order(client):
    r = client.post("/orders", json=ORDER)
    assert r.status_code == 201
    body = r.json()
    assert r.headers["location"] == f"/orders/{body['id']}"
    assert body["customer"] == "Ines Duarte"
    assert body["status"] == "placed"
    assert body["lines"] == [{"sku": "SOURDOUGH", "quantity": 2}]


def test_read_order(client):
    created = client.post("/orders", json=ORDER).json()
    r = client.get(f"/orders/{created['id']}")
    assert r.status_code == 200
    assert r.json() == created


def test_unknown_order_is_404(client):
    r = client.get("/orders/999")
    assert r.status_code == 404
    assert r.json() == {"detail": "Order not found"}


def test_cancel_order(client):
    created = client.post("/orders", json=ORDER).json()
    r = client.post(f"/orders/{created['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    assert client.get(f"/orders/{created['id']}").json()["status"] == "cancelled"


def test_cancel_twice_is_409(client):
    created = client.post("/orders", json=ORDER).json()
    client.post(f"/orders/{created['id']}/cancel")
    r = client.post(f"/orders/{created['id']}/cancel")
    assert r.status_code == 409
    assert r.json() == {"detail": "Order is already cancelled"}


def test_cancel_unknown_is_404(client):
    assert client.post("/orders/41/cancel").status_code == 404


def test_order_needs_lines(client):
    r = client.post("/orders", json={"customer": "Ines Duarte", "lines": []})
    assert r.status_code == 422
