from fastapi import FastAPI

from app.audit import assert_admin_routes_guarded
from app.routers import admin, catalog
from app.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Backoffice API", version="5.2.1")
    app.state.settings = settings
    app.include_router(catalog.router)
    app.include_router(admin.router)

    # Refuse to boot if any admin route lost its guard.
    assert_admin_routes_guarded(app)
    return app
