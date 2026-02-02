from datetime import datetime, timedelta

import pytz
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.entitlements import normalize_account_type
from app.services.IP_usage_limit import get_week_start_gmt3


router = APIRouter()

EXTENSION_WEEKLY_LIMIT = 3


class ExtensionPermitRequest(BaseModel):
    url: str | None = None
    dry_run: bool = False


def _get_reset_at() -> tuple[str, int]:
    timezone = pytz.timezone("Africa/Kampala")
    now = datetime.now(timezone)
    week_start = datetime.strptime(get_week_start_gmt3(), "%Y-%m-%d")
    week_start = timezone.localize(week_start)
    reset_at = week_start + timedelta(days=7)
    ttl_seconds = max(int((reset_at - now).total_seconds()), 60)
    return reset_at.isoformat(), ttl_seconds


@router.post("/api/extension/unlock-permit")
async def extension_unlock_permit(request: Request, payload: ExtensionPermitRequest):
    user_id = request.state.user_id
    if not user_id:
        return JSONResponse(
            {
                "allowed": False,
                "remaining": 0,
                "reset_at": None,
                "reason": "unauthenticated",
                "account_type": "freemium",
            },
            status_code=401,
        )

    account_type = normalize_account_type(request.state.account_type)
    response_account_type = "freemium" if account_type == "free" else account_type
    reset_at, ttl_seconds = _get_reset_at()

    if account_type != "free":
        return {
            "allowed": True,
            "remaining": -1,
            "reset_at": reset_at,
            "reason": "ok",
            "account_type": response_account_type,
        }

    usage_key = f"extension_usage_week:{user_id}:{get_week_start_gmt3()}"
    usage_count = int(await request.app.state.redis_get(usage_key) or 0)

    allowed = usage_count < EXTENSION_WEEKLY_LIMIT
    if allowed and not payload.dry_run:
        await request.app.state.redis_incr(usage_key)
        if usage_count == 0:
            await request.app.state.redis_expire(usage_key, ttl_seconds)
        usage_count += 1

    remaining = max(EXTENSION_WEEKLY_LIMIT - usage_count, 0)
    reason = "ok" if allowed else "limit_reached"

    return {
        "allowed": allowed,
        "remaining": remaining,
        "reset_at": reset_at,
        "reason": reason,
        "account_type": response_account_type,
    }
