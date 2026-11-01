from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI, Security
from fastapi.testclient import TestClient

from app.audit import assert_admin_routes_guarded, unguarded_admin_routes
from app.main import create_app
from app.security import current_admin, require_admin
from app.settings import Settings

TOKEN = "hidden-admin-token"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(admin_token=TOKEN, environment="verify")))


def test_the_real_app_boots_with_every_admin_route_guarded():
    app = create_app(Settings(admin_token=TOKEN))
    assert unguarded_admin_routes(app) == []


def test_the_download_now_needs_an_admin_token(client):
    assert client.get("/admin/exports/7/download").status_code == 401
    assert client.get("/admin/exports/7/download", headers={"X-Admin-Token": "x"}).status_code == 403
    r = client.get("/admin/exports/7/download", headers={"X-Admin-Token": TOKEN})
    assert r.status_code == 200
    assert r.text.startswith("id,email\n")
    assert client.get("/admin/exports/99/download", headers={"X-Admin-Token": TOKEN}).status_code == 404


def test_the_rest_of_the_app_is_unchanged(client):
    admin = {"X-Admin-Token": TOKEN}
    assert client.get("/catalog/products").status_code == 200
    assert client.post("/admin/exports").status_code == 401
    assert client.post("/admin/exports", headers=admin).status_code == 202
    assert client.post("/admin/users/2/suspend").status_code == 401
    assert client.get("/admin/reports/refunds", headers=admin).json()["total_cents"] == 18_900
    assert client.get("/admin/me", headers=admin).json() == {"admin": "admin@verify"}


def test_create_app_refuses_to_boot_with_an_unguarded_nested_route(monkeypatch):
    from app.routers import admin as admin_routers

    leaky_admin = APIRouter(prefix="/admin")
    leaky = APIRouter(prefix="/leaky")

    @leaky.get("/{export_id}/download")
    def leak(export_id: int) -> str:
        return ""

    leaky_admin.include_router(leaky)
    monkeypatch.setattr(admin_routers, "router", leaky_admin)
    with pytest.raises(RuntimeError, match=r"GET /admin/leaky/\{export_id\}/download"):
        create_app(Settings(admin_token=TOKEN))


def nested_app() -> FastAPI:
    app = FastAPI()
    admin = APIRouter(prefix="/admin")
    billing = APIRouter(prefix="/billing")
    invoices = APIRouter(prefix="/invoices")

    @invoices.get("/{invoice_id}")
    def read_invoice(invoice_id: int) -> dict:
        return {}

    @invoices.delete("/{invoice_id}", dependencies=[Depends(require_admin)])
    def delete_invoice(invoice_id: int) -> dict:
        return {}

    billing.include_router(invoices)
    admin.include_router(billing)
    app.include_router(admin)
    return app


def test_nested_routers_report_the_full_path():
    assert unguarded_admin_routes(nested_app()) == [("GET", "/admin/billing/invoices/{invoice_id}")]


def test_guards_count_wherever_they_are_declared():
    app = FastAPI()
    by_router = APIRouter(prefix="/admin/team", dependencies=[Depends(require_admin)])

    @by_router.get("/members")
    def members() -> list:
        return []

    at_include = APIRouter()

    @at_include.get("/ledger")
    def ledger() -> dict:
        return {}

    by_param = APIRouter(prefix="/admin/flags")

    @by_param.put("/{name}")
    def set_flag(name: str, _: Annotated[None, Depends(require_admin)]) -> dict:
        return {}

    @by_param.get("/audit")
    def flag_audit(admin: Annotated[str, Depends(current_admin)]) -> dict:
        return {}

    @by_param.get("/scoped")
    def scoped(admin: Annotated[str, Security(current_admin, scopes=["flags"])]) -> dict:
        return {}

    app.include_router(by_router)
    app.include_router(at_include, prefix="/admin/finance", dependencies=[Depends(require_admin)])
    app.include_router(by_param)
    assert unguarded_admin_routes(app) == []


def test_app_level_dependencies_guard_everything():
    app = FastAPI(dependencies=[Depends(require_admin)])
    router = APIRouter(prefix="/admin/jobs")

    @router.get("")
    def jobs() -> list:
        return []

    @app.get("/admin/ping")
    def ping() -> dict:
        return {}

    app.include_router(router)
    assert unguarded_admin_routes(app) == []


def test_one_router_included_twice_is_judged_per_inclusion():
    app = FastAPI()
    shared = APIRouter()

    @shared.get("/settings")
    def settings_view() -> dict:
        return {}

    app.include_router(shared, prefix="/admin/v1", dependencies=[Depends(require_admin)])
    app.include_router(shared, prefix="/admin/v2")
    assert unguarded_admin_routes(app) == [("GET", "/admin/v2/settings")]


def test_routes_added_after_include_router_are_seen():
    app = FastAPI()
    late = APIRouter(prefix="/admin/late")
    app.include_router(late)

    @late.post("/purge")
    def purge() -> dict:
        return {}

    assert unguarded_admin_routes(app) == [("POST", "/admin/late/purge")]


def test_hidden_and_multi_method_routes_are_reported():
    app = FastAPI()
    tools = APIRouter(prefix="/admin/tools")

    @tools.api_route("/cache", methods=["GET", "DELETE"], include_in_schema=False)
    def cache() -> dict:
        return {}

    app.include_router(tools)
    assert unguarded_admin_routes(app) == [("DELETE", "/admin/tools/cache"), ("GET", "/admin/tools/cache")]


def test_only_admin_paths_are_judged():
    app = FastAPI()
    router = APIRouter()

    @router.get("/administrators")
    def not_admin() -> list:
        return []

    @router.get("/public/admin/docs")
    def also_not_admin() -> dict:
        return {}

    @router.get("/admin")
    def admin_root() -> dict:
        return {}

    app.include_router(router)
    assert unguarded_admin_routes(app) == [("GET", "/admin")]


def test_assert_names_nested_routes():
    with pytest.raises(RuntimeError, match=r"GET /admin/billing/invoices/\{invoice_id\}"):
        assert_admin_routes_guarded(nested_app())
