from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.service import IdentityService
from app.modules.insights.activity_service import ActivityService
from app.modules.insights.repo import InsightsRepository
from app.modules.insights.service import InsightsService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["insights"])
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
service = InsightsService(repository=InsightsRepository(supabase_repo=supabase_repo), contract=str(settings.migration_pack_dir))
activity_service = ActivityService(repository=service.repository)


async def _insight_access(auth_context: RequestAuthContext = Depends(require_request_auth_context)):
    _account_state, capability_state = await identity_service.resolve_access_state(auth_context)
    return {
        "user_id": auth_context.user_id,
        "capability_state": capability_state,
    }


@router.get("/api/insights/status")
async def insights_status() -> dict[str, object]:
    return service.status()


@router.get("/api/insights/momentum")
async def get_momentum(month: str | None = None, x_user_timezone: str | None = Header(default=None), access=Depends(_insight_access)):
    return await service.momentum(user_id=access["user_id"], month=month, timezone_name=x_user_timezone)


@router.get("/api/insights/domains")
async def get_domains(month: str | None = None, x_user_timezone: str | None = Header(default=None), access=Depends(_insight_access)):
    return await service.domain_summary(user_id=access["user_id"], month=month, timezone_name=x_user_timezone)


@router.get("/api/insights/citation-styles")
async def get_citation_styles(month: str | None = None, x_user_timezone: str | None = Header(default=None), access=Depends(_insight_access)):
    return await service.citation_style_summary(user_id=access["user_id"], month=month, timezone_name=x_user_timezone)


@router.get("/api/insights/monthly-summary")
async def get_monthly_summary(month: str | None = None, x_user_timezone: str | None = Header(default=None), access=Depends(_insight_access)):
    return await service.monthly_summary(user_id=access["user_id"], month=month, timezone_name=x_user_timezone)


@router.get("/api/reports/monthly")
async def get_monthly_report(month: str | None = None, x_user_timezone: str | None = Header(default=None), access=Depends(_insight_access)):
    return await service.monthly_report(
        user_id=access["user_id"],
        capability_state=access["capability_state"],
        month=month,
        timezone_name=x_user_timezone,
    )


@router.get("/api/insights/activity")
async def get_activity(days: int = 30, access=Depends(_insight_access)):
    return await activity_service.activity_summary(user_id=access["user_id"], days=days)


@router.get("/api/insights/streak")
async def get_streak(access=Depends(_insight_access)):
    return await activity_service.streak_summary(user_id=access["user_id"])


@router.get("/api/insights/milestones")
async def get_milestones(access=Depends(_insight_access)):
    return await activity_service.milestones_summary(user_id=access["user_id"])
