import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app import repository
from app.db import get_db
from app.schemas import OrderIn, OrderOut

router = APIRouter(prefix="/orders", tags=["orders"])

# scope="function": commit (or fail with 503) before the response is sent, not after.
Db = Annotated[sqlite3.Connection, Depends(get_db, scope="function")]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_order(order: OrderIn, db: Db, response: Response) -> OrderOut:
    order_id = repository.insert_order(db, order)
    created = repository.fetch_order(db, order_id)
    assert created is not None
    response.headers["Location"] = f"/orders/{order_id}"
    return created


@router.get("/{order_id}")
def read_order(order_id: int, db: Db) -> OrderOut:
    order = repository.fetch_order(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.post("/{order_id}/cancel")
def cancel_order(order_id: int, db: Db) -> OrderOut:
    order = repository.fetch_order(db, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if order.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Order is already cancelled")
    repository.set_status(db, order_id, "cancelled")
    cancelled = repository.fetch_order(db, order_id)
    assert cancelled is not None
    return cancelled
