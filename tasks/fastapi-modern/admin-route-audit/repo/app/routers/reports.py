from fastapi import APIRouter

# Guarded where it is included (see app/routers/admin.py).
router = APIRouter(tags=["reports"])


@router.get("/revenue")
def revenue() -> dict:
    return {"currency": "EUR", "total_cents": 1_250_000}


@router.get("/refunds")
def refunds() -> dict:
    return {"currency": "EUR", "total_cents": 18_900}
