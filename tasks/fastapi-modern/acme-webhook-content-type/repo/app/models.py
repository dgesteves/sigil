from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field


class PaymentEvent(BaseModel):
    """An Acme Pay webhook event (https://docs.acme-pay.example/webhooks, API version 2025-06)."""

    id: str = Field(pattern=r"^evt_[A-Za-z0-9]{8,32}$")
    type: Literal["payment.succeeded", "payment.failed", "refund.succeeded"]
    order_id: str = Field(min_length=1, max_length=64)
    amount_cents: int = Field(ge=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    created: AwareDatetime


class CheckoutIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=64)
    amount_cents: int = Field(gt=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class CheckoutOut(BaseModel):
    checkout_id: str
    order_id: str
    status: Literal["pending"]
