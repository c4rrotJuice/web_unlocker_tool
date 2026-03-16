from fastapi import APIRouter

from app.modules.workspace.service import WorkspaceService


router = APIRouter(prefix="/api/workspace", tags=["workspace"])
service = WorkspaceService()


@router.get("/status")
async def workspace_status() -> dict[str, object]:
    return service.status()
