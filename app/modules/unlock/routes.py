from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.core.entitlements import derive_capability_state
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.service import IdentityService
from app.modules.unlock.repo import UnlockRepository
from app.modules.unlock.schemas import ActivityEventCreateRequest, ActivityHistoryQuery, BookmarkCreateRequest, BookmarkListQuery
from app.modules.unlock.service import UnlockService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["activity"])
settings = get_settings()
supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
identity_service = IdentityService(
    repository=IdentityRepository(
        user_supabase_repo=supabase_repo,
        bootstrap_supabase_repo=supabase_repo,
        anon_key=settings.supabase_anon_key,
    )
)
service = UnlockService(repository=UnlockRepository(supabase_repo=supabase_repo), contract=str(settings.migration_pack_dir))


async def _activity_access(auth_context: RequestAuthContext = Depends(require_request_auth_context)):
    account_state = await identity_service.ensure_account_bootstrapped(auth_context)
    capability_state = derive_capability_state(
        user_id=account_state.profile.user_id,
        tier=account_state.entitlement.tier,
        status=account_state.entitlement.status,
        paid_until=account_state.entitlement.paid_until,
    )
    return {
        "user_id": auth_context.user_id,
        "access_token": auth_context.access_token,
        "capability_state": capability_state,
    }


@router.get("/api/unlock/status")
async def unlock_status() -> dict[str, object]:
    return service.status()


@router.post("/api/activity/events")
async def create_activity_event(payload: ActivityEventCreateRequest, access=Depends(_activity_access)):
    return await service.record_activity_event(user_id=access["user_id"], payload=payload.model_dump(exclude_none=True))


@router.get("/api/activity/unlocks")
async def list_activity_history(
    event_type: str | None = None,
    domain: str | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    sort: str = "created_at",
    direction: str = "desc",
    access=Depends(_activity_access),
):
    query = ActivityHistoryQuery(
        event_type=event_type,
        domain=domain,
        limit=limit,
        cursor=cursor,
        sort=sort,
        direction=direction,
    )
    return await service.list_activity_history(
        user_id=access["user_id"],
        event_type=query.event_type,
        domain=query.domain,
        limit=query.limit,
        cursor=query.cursor,
        direction=query.direction,
    )


@router.get("/api/activity/bookmarks")
async def list_bookmarks(
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = None,
    sort: str = "created_at",
    direction: str = "desc",
    access=Depends(_activity_access),
):
    query = BookmarkListQuery(limit=limit, cursor=cursor, sort=sort, direction=direction)
    return await service.list_bookmarks(
        user_id=access["user_id"],
        limit=query.limit,
        cursor=query.cursor,
        direction=query.direction,
    )


@router.post("/api/activity/bookmarks")
async def create_bookmark(payload: BookmarkCreateRequest, access=Depends(_activity_access)):
    return await service.create_bookmark(
        user_id=access["user_id"],
        capability_state=access["capability_state"],
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/activity/bookmarks/{bookmark_id}")
async def delete_bookmark(bookmark_id: str, access=Depends(_activity_access)):
    return await service.delete_bookmark(user_id=access["user_id"], bookmark_id=bookmark_id)


@router.get("/api/activity/milestones")
async def list_milestones(access=Depends(_activity_access)):
    return await service.list_milestones(user_id=access["user_id"])
