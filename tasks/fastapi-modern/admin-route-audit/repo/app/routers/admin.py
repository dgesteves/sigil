from fastapi import APIRouter, Depends

from app.routers import exports, reports, users
from app.security import CurrentAdmin, require_admin

router = APIRouter(prefix="/admin")


@router.get("/me")
def whoami(admin: CurrentAdmin) -> dict:
    return {"admin": admin}


router.include_router(users.router)
router.include_router(exports.router)
router.include_router(reports.router, prefix="/reports", dependencies=[Depends(require_admin)])
