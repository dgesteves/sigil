from fastapi import APIRouter, Request, status

from app.models import CheckoutIn, CheckoutOut

router = APIRouter(prefix="/checkouts", tags=["checkout"])


@router.post("", status_code=status.HTTP_201_CREATED)
def start_checkout(checkout: CheckoutIn, request: Request) -> CheckoutOut:
    checkouts: dict[str, CheckoutIn] = request.app.state.checkouts
    checkout_id = f"chk_{len(checkouts) + 1:06d}"
    checkouts[checkout_id] = checkout
    return CheckoutOut(checkout_id=checkout_id, order_id=checkout.order_id, status="pending")
