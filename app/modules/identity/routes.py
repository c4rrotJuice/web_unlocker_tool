from fastapi import APIRouter, Depends

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.service import IdentityService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(prefix="/api/identity", tags=["identity"])
settings = get_settings()
supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
service = IdentityService(repository=IdentityRepository(supabase_repo=supabase_repo))


@router.get("/status")
async def identity_status() -> dict[str, object]:
    return service.status()


@router.get("/me")
async def identity_me(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.me(auth_context)


@router.get("/account")
async def identity_account(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.account(auth_context)


@router.get("/capabilities")
async def identity_capabilities(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.capabilities(auth_context)
