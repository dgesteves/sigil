import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader

admin_token_header = APIKeyHeader(name="X-Admin-Token", description="Back-office admin token")


def require_admin(request: Request, token: Annotated[str, Depends(admin_token_header)]) -> None:
    """Guard for everything under /admin. Missing header: 401 (from APIKeyHeader). Wrong token: 403."""
    expected = request.app.state.settings.admin_token
    if not secrets.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not an admin token")


def current_admin(_: Annotated[None, Depends(require_admin)], request: Request) -> str:
    return f"admin@{request.app.state.settings.environment}"


AdminOnly = Annotated[None, Depends(require_admin)]
CurrentAdmin = Annotated[str, Depends(current_admin)]
