import sqlite3
from datetime import UTC, datetime

from app.schemas import OrderIn, OrderLineOut, OrderOut


def insert_order(conn: sqlite3.Connection, order: OrderIn) -> int:
    cur = conn.execute(
        "INSERT INTO orders (customer, created_at) VALUES (?, ?)",
        (order.customer, datetime.now(UTC).isoformat()),
    )
    order_id = cur.lastrowid
    assert order_id is not None
    conn.executemany(
        "INSERT INTO order_lines (order_id, sku, quantity) VALUES (?, ?, ?)",
        [(order_id, line.sku, line.quantity) for line in order.lines],
    )
    return order_id


def fetch_order(conn: sqlite3.Connection, order_id: int) -> OrderOut | None:
    row = conn.execute(
        "SELECT id, customer, status, created_at FROM orders WHERE id = ?", (order_id,)
    ).fetchone()
    if row is None:
        return None
    lines = conn.execute(
        "SELECT sku, quantity FROM order_lines WHERE order_id = ? ORDER BY rowid", (order_id,)
    ).fetchall()
    return OrderOut(
        id=row["id"],
        customer=row["customer"],
        status=row["status"],
        created_at=row["created_at"],
        lines=[OrderLineOut(sku=line["sku"], quantity=line["quantity"]) for line in lines],
    )


def set_status(conn: sqlite3.Connection, order_id: int, status: str) -> None:
    conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
