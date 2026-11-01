from fastapi import APIRouter, Depends

from app.security import require_admin

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])

USERS = [{"id": 1, "email": "ops@example.org"}, {"id": 2, "email": "finance@example.org"}]


@router.get("")
def list_users() -> list[dict]:
    return USERS


@router.post("/{user_id}/suspend")
def suspend_user(user_id: int) -> dict:
    return {"id": user_id, "suspended": True}
