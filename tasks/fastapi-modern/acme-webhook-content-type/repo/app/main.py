from fastapi import FastAPI

from app import checkout, webhooks
from app.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Payments Gateway", version="2.9.0")
    app.state.settings = settings
    app.state.ledger = {}
    app.state.checkouts = {}
    app.include_router(checkout.router)
    app.include_router(webhooks.router)
    return app
