from fastapi import APIRouter

from app.modules.insights.service import InsightsService


router = APIRouter(prefix="/api/insights", tags=["insights"])
service = InsightsService()


@router.get("/status")
async def insights_status() -> dict[str, object]:
    return service.status()
