import hashlib
import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.models import PaymentEvent

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def signature_is_valid(secret: str, body: bytes, header: str) -> bool:
    scheme, _, digest = header.partition("=")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return scheme == "sha256" and hmac.compare_digest(digest, expected)


@router.post("/acme-pay")
async def acme_pay_webhook(
    event: PaymentEvent,
    request: Request,
    x_acme_signature: Annotated[str, Header()],
) -> dict:
    """Acme Pay event delivery. Acme retries until it gets a 2xx, so this must be idempotent."""
    body = await request.body()
    if not signature_is_valid(request.app.state.settings.acme_webhook_secret, body, x_acme_signature):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid signature")
    ledger: dict[str, PaymentEvent] = request.app.state.ledger
    ledger.setdefault(event.id, event)
    return {"received": event.id}
