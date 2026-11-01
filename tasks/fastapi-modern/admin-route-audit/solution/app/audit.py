"""Boot-time safety check: no route under /admin may be reachable without `require_admin`."""

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts

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
    # Since FastAPI 0.137, app.routes is a tree: included routers stay `_IncludedRouter` nodes
    # instead of being copied in. iter_route_contexts() walks it and gives each route as the app
    # serves it: full path, methods, and the effective dependant (include-level and app-level
    # dependencies merged in).
    for context in iter_route_contexts(app.routes):
        if not isinstance(context.original_route, APIRoute) or not _is_admin_path(context.path):
            continue
        if not _depends_on(context.dependant, require_admin):
            found.extend((method, context.path) for method in context.methods)
    return sorted(found)


def assert_admin_routes_guarded(app: FastAPI) -> None:
    missing = unguarded_admin_routes(app)
    if missing:
        listed = ", ".join(f"{method} {path}" for method, path in missing)
        raise RuntimeError(f"admin routes reachable without require_admin: {listed}")
