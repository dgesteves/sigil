"""Helpers the HTTP handlers call. Clients and the document store depend on their exact output."""

import json
from typing import Any, List, Optional

from pydantic import ValidationError

from .models import Claim, ClaimBatch


def parse_claim(body: bytes | str) -> Claim:
    return Claim.parse_raw(body)


def parse_batch(body: bytes | str) -> List[Claim]:
    return ClaimBatch.parse_raw(body).__root__


def claim_json(claim: Claim) -> str:
    """The response body for GET /claims/{id}."""
    return claim.json(by_alias=True)


def claim_document(claim: Claim) -> dict[str, Any]:
    """What we store in the document database: the same shape as the API response."""
    return json.loads(claim.json(by_alias=True))


def batch_json(claims: List[Claim]) -> str:
    return ClaimBatch(__root__=claims).json(by_alias=True)


def claim_from_row(row: Any) -> Claim:
    """Build a Claim from a database row object (attributes, not a dict)."""
    return Claim.from_orm(row)


def with_changes(claim: Claim, **changes: Any) -> Claim:
    """Apply an adjuster's edits (field names, not aliases) and re-validate the whole claim."""
    return Claim.parse_obj({**claim.dict(), **changes})


def api_errors(exc: ValidationError) -> List[dict[str, Optional[str]]]:
    """The 422 body: one entry per problem, `field` is the dotted alias path (None for whole-claim rules)."""
    problems = []
    for error in exc.errors():
        path = [str(part) for part in error["loc"] if part != "__root__"]
        problems.append({"field": ".".join(path) or None, "message": error["msg"]})
    return problems
