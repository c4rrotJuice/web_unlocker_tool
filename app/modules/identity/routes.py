from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from supabase import create_client
from supabase.client import AuthApiError

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.schemas import PreferencesPatchRequest, ProfilePatchRequest, SignupRequest
from app.modules.identity.service import IdentityService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["account"])
settings = get_settings()
user_supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
bootstrap_supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
service = IdentityService(
    repository=IdentityRepository(
        user_supabase_repo=user_supabase_repo,
        bootstrap_supabase_repo=bootstrap_supabase_repo,
        anon_key=settings.supabase_anon_key,
    )
)
supabase_admin = create_client(settings.supabase_url or "", settings.supabase_service_role_key or "")


def _create_supabase_user(*, email: str | None, password: str | None):
    if not email or not password:
        raise HTTPException(status_code=422, detail="email and password are required when user_id is not provided.")
    admin_api = getattr(getattr(supabase_admin, "auth", None), "admin", None)
    if admin_api is not None and hasattr(admin_api, "create_user"):
        created = admin_api.create_user({"email": email, "password": password, "email_confirm": False})
        user = getattr(created, "user", None)
        return user or created
    created = supabase_admin.auth.sign_up({"email": email, "password": password})
    return getattr(created, "user", None)


@router.get("/api/identity/status")
async def identity_status() -> dict[str, object]:
    return service.status()


@router.post("/api/auth/signup")
async def signup(payload: SignupRequest) -> dict[str, object]:
    try:
        return await service.signup(payload, create_user=_create_supabase_user)
    except AuthApiError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


@router.get("/api/me")
async def me(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.me(auth_context)


@router.get("/api/profile")
async def get_profile(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.profile(auth_context)


@router.patch("/api/profile")
async def patch_profile(
    payload: ProfilePatchRequest,
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.update_profile(auth_context, payload)


@router.get("/api/preferences")
async def get_preferences(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.preferences(auth_context)


@router.patch("/api/preferences")
async def patch_preferences(
    payload: PreferencesPatchRequest,
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.update_preferences(auth_context, payload)


@router.get("/api/entitlements/current")
async def get_current_entitlement(
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
) -> dict[str, object]:
    return await service.current_entitlement(auth_context)
