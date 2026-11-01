from typing import Annotated

import pytest
from fastapi import Depends, FastAPI

from app.audit import assert_admin_routes_guarded, unguarded_admin_routes
from app.security import require_admin


def make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/admin/guarded")
    def guarded(_: Annotated[None, Depends(require_admin)]) -> dict:
        return {}

    @app.post("/admin/open")
    def open_route() -> dict:
        return {}

    @app.get("/public")
    def public() -> dict:
        return {}

    return app


def test_reports_unguarded_admin_routes():
    assert unguarded_admin_routes(make_app()) == [("POST", "/admin/open")]


def test_assert_raises_and_names_the_route():
    with pytest.raises(RuntimeError, match="POST /admin/open"):
        assert_admin_routes_guarded(make_app())
