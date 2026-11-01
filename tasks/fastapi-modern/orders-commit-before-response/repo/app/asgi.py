"""Entry point for the production server: `uvicorn app.asgi:app`."""

import os

from app.main import create_app

app = create_app(os.environ.get("ORDERS_DB", "orders.db"))
