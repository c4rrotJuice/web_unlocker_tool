from fastapi import APIRouter, Depends

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.billing.repo import BillingRepository
from app.modules.billing.service import BillingService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["billing"])
settings = get_settings()
supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
service = BillingService(repository=BillingRepository(supabase_repo=supabase_repo))


@router.get("/api/billing/status")
async def billing_status() -> dict[str, object]:
    return service.status()


@router.get("/api/billing/customer")
async def get_billing_customer(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.customer(auth_context.user_id)


@router.get("/api/billing/subscription")
async def get_billing_subscription(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.subscription(auth_context.user_id)
