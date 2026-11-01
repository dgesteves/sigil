from fastapi import APIRouter

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/products")
def products() -> list[dict]:
    return [{"sku": "TEA-01", "name": "Green tea"}, {"sku": "TEA-02", "name": "Oolong"}]
