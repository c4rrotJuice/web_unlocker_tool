from fastapi import APIRouter

from app.modules.extension.service import ExtensionService


router = APIRouter(prefix="/api/extension", tags=["extension"])
service = ExtensionService()


@router.get("/status")
async def extension_status() -> dict[str, object]:
    return service.status()
