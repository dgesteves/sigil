from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

from app.security import AdminOnly, require_admin

router = APIRouter(prefix="/exports", tags=["exports"])

EXPORTS = {7: "id,email\n1,ops@example.org\n2,finance@example.org\n"}


@router.post("", status_code=202, dependencies=[Depends(require_admin)])
def start_export() -> dict:
    return {"id": 8, "state": "queued"}


@router.get("/{export_id}")
def export_status(export_id: int, _: AdminOnly) -> dict:
    if export_id not in EXPORTS:
        raise HTTPException(404, "Export not found")
    return {"id": export_id, "state": "ready"}


@router.get("/{export_id}/download", response_class=PlainTextResponse)
def download_export(export_id: int) -> str:
    if export_id not in EXPORTS:
        raise HTTPException(404, "Export not found")
    return EXPORTS[export_id]
