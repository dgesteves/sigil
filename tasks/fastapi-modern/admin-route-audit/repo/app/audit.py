"""Boot-time safety check: no route under /admin may be reachable without `require_admin`."""

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.security import require_admin


def _is_admin_path(path: str) -> bool:
    return path == "/admin" or path.startswith("/admin/")


def _depends_on(dependant: Dependant, guard) -> bool:
    return dependant.call is guard or any(_depends_on(d, guard) for d in dependant.dependencies)


def unguarded_admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every (METHOD, path) under /admin that a request can reach without `require_admin`.

    The guard counts wherever it is declared: as an endpoint parameter, in the route's or the
    router's `dependencies`, at `include_router(..., dependencies=...)`, on the app, or as a
    sub-dependency of another dependency. Paths are the full paths the app serves. Sorted.
    """
    found: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not _is_admin_path(route.path):
            continue
        if not _depends_on(route.dependant, require_admin):
            found.extend((method, route.path) for method in route.methods)
    return sorted(found)


def assert_admin_routes_guarded(app: FastAPI) -> None:
    missing = unguarded_admin_routes(app)
    if missing:
        listed = ", ".join(f"{method} {path}" for method, path in missing)
        raise RuntimeError(f"admin routes reachable without require_admin: {listed}")
