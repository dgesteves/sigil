"""Statement documents for the customer API (GET /statements/{id}) and the response cache."""

from typing import Any

from .models import Statement


def render_statement(statement: Statement) -> str:
    """Response body for GET /statements/{id}."""
    return statement.model_dump_json(exclude_none=True)


def statement_payload(statement: Statement) -> dict[str, Any]:
    """The same document as a dict, for the cache layer (which stores it with json.dumps)."""
    return statement.model_dump(mode="json", exclude_none=True)
