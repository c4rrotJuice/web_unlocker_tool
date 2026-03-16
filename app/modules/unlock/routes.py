from fastapi import APIRouter

from app.modules.unlock.service import UnlockService


router = APIRouter(prefix="/api/unlock", tags=["unlock"])
service = UnlockService()


@router.get("/status")
async def unlock_status() -> dict[str, object]:
    return service.status()
