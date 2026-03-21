from fastapi import APIRouter, Depends, Request

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.billing.repo import BillingRepository
from app.modules.billing.schemas import BillingCheckoutRequest
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


@router.post("/api/billing/checkout")
async def create_billing_checkout(
    payload: BillingCheckoutRequest,
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.create_checkout(auth_context, payload.tier, payload.interval)


@router.post("/api/webhooks/paddle")
async def paddle_webhook(request: Request) -> dict[str, object]:
    raw_body = await request.body()
    signature_header = request.headers.get("Paddle-Signature")
    return await service.handle_paddle_webhook(request, raw_body, signature_header)
