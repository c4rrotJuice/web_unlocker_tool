from fastapi import APIRouter

from app.modules.research.service import ResearchService


router = APIRouter(prefix="/api/research", tags=["research"])
service = ResearchService()


@router.get("/status")
async def research_status() -> dict[str, object]:
    return service.status()
