from fastapi import APIRouter

from app.modules.billing.service import BillingService


router = APIRouter(prefix="/api/billing", tags=["billing"])
service = BillingService()


@router.get("/status")
async def billing_status() -> dict[str, object]:
    return service.status()
