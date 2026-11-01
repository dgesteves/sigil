"""A 2xx may only reach the client after the request's writes are committed, and a failed
commit must turn into a 503 with nothing saved."""

import asyncio
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

SAVE_FAILED = {"detail": "Could not save your changes, please try again"}


def order_body(customer: str) -> dict:
    return {
        "customer": customer,
        "lines": [{"sku": "RYE", "quantity": 1}, {"sku": "CROISSANT", "quantity": 6}],
    }


class DiskFullOnCommit(sqlite3.Connection):
    """Commits fail whenever there is something to commit, like a full disk would."""

    def commit(self) -> None:
        if self.in_transaction:
            raise sqlite3.OperationalError("database or disk is full")
        super().commit()


def boot(app) -> None:
    with TestClient(app):  # runs the lifespan, which creates the schema
        pass


def asgi_request(app, method: str, path: str, body: dict | None, on_response_start):
    """Drive the ASGI app directly so the test sees the moment the status line is sent."""
    payload = json.dumps(body).encode() if body is not None else b""
    headers = [(b"host", b"testserver"), (b"content-length", str(len(payload)).encode())]
    if body is not None:
        headers.append((b"content-type", b"application/json"))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": {},
    }
    result: dict = {"body": b""}

    async def run() -> None:
        done = asyncio.Event()
        body_sent = False

        async def receive():
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {"type": "http.request", "body": payload, "more_body": False}
            await done.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                result["status"] = message["status"]
                result["seen_at_start"] = on_response_start()
            elif message["type"] == "http.response.body":
                result["body"] += message.get("body", b"")
                if not message.get("more_body", False):
                    done.set()

        await asyncio.wait_for(app(scope, receive, send), timeout=10)

    asyncio.run(run())
    return result


def read_db(path, sql: str, params=()):
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "orders.db"


def test_created_order_is_committed_before_the_201_goes_out(db_path):
    app = create_app(db_path)
    boot(app)

    def committed_rows():
        orders = read_db(db_path, "SELECT id FROM orders WHERE customer = ?", ("Rui Prata",))
        lines = read_db(
            db_path,
            "SELECT count(*) FROM order_lines JOIN orders ON orders.id = order_lines.order_id "
            "WHERE orders.customer = ?",
            ("Rui Prata",),
        )
        return len(orders), lines[0][0]

    result = asgi_request(app, "POST", "/orders", order_body("Rui Prata"), committed_rows)
    assert result["status"] == 201
    assert result["seen_at_start"] == (1, 2), (
        "the 201 was sent before the order and its lines were committed"
    )
    assert json.loads(result["body"])["customer"] == "Rui Prata"


def test_cancellation_is_committed_before_the_200_goes_out(db_path):
    app = create_app(db_path)
    with TestClient(app) as client:
        order_id = client.post("/orders", json=order_body("Marta Lobo")).json()["id"]

    def committed_status():
        return read_db(db_path, "SELECT status FROM orders WHERE id = ?", (order_id,))[0][0]

    result = asgi_request(app, "POST", f"/orders/{order_id}/cancel", None, committed_status)
    assert result["status"] == 200
    assert result["seen_at_start"] == "cancelled", (
        "the 200 was sent before the cancellation was committed"
    )


def test_failed_commit_on_create_is_a_503_and_saves_nothing(db_path):
    failing = create_app(db_path, connection_class=DiskFullOnCommit)
    with TestClient(failing, raise_server_exceptions=False) as client:
        r = client.post("/orders", json=order_body("Joana Reis"))
        assert r.status_code == 503
        assert r.json() == SAVE_FAILED
    assert read_db(db_path, "SELECT count(*) FROM orders")[0][0] == 0
    assert read_db(db_path, "SELECT count(*) FROM order_lines")[0][0] == 0


def test_failed_commit_on_cancel_is_a_503_and_keeps_the_order(db_path):
    with TestClient(create_app(db_path)) as client:
        order_id = client.post("/orders", json=order_body("Tiago Sá")).json()["id"]
    failing = create_app(db_path, connection_class=DiskFullOnCommit)
    with TestClient(failing, raise_server_exceptions=False) as client:
        r = client.post(f"/orders/{order_id}/cancel")
        assert r.status_code == 503
        assert r.json() == SAVE_FAILED
    with TestClient(create_app(db_path)) as client:
        assert client.get(f"/orders/{order_id}").json()["status"] == "placed"


def test_reads_still_work_when_commits_would_fail(db_path):
    with TestClient(create_app(db_path)) as client:
        created = client.post("/orders", json=order_body("Ana Faria")).json()
    failing = create_app(db_path, connection_class=DiskFullOnCommit)
    with TestClient(failing, raise_server_exceptions=False) as client:
        r = client.get(f"/orders/{created['id']}")
        assert r.status_code == 200
        assert r.json() == created
        assert client.get("/orders/987").status_code == 404


def test_client_errors_are_unchanged(db_path):
    with TestClient(create_app(db_path)) as client:
        order_id = client.post("/orders", json=order_body("Hugo Neves")).json()["id"]
        assert client.post(f"/orders/{order_id}/cancel").status_code == 200
        r = client.post(f"/orders/{order_id}/cancel")
        assert r.status_code == 409
        assert r.json() == {"detail": "Order is already cancelled"}
        assert client.post("/orders/555/cancel").json() == {"detail": "Order not found"}
        assert client.post("/orders", json={"customer": "x", "lines": []}).status_code == 422
    assert read_db(db_path, "SELECT status FROM orders WHERE id = ?", (order_id,))[0][0] == "cancelled"
