from datetime import datetime, timedelta
import os

import pytz
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.routes.http import http_client
from app.services.entitlements import normalize_account_type
from app.services.IP_usage_limit import get_week_start_gmt3
from app.routes.citations import CitationInput, create_citation
from app.routes.editor import _doc_expiration, _get_account_type


router = APIRouter()

EXTENSION_WEEKLY_LIMIT = 3
EXTENSION_EDITOR_WEEKLY_LIMIT = 500
PAID_TIERS = {"standard", "pro"}
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


class ExtensionPermitRequest(BaseModel):
    url: str | None = None
    dry_run: bool = False


class ExtensionSelectionRequest(BaseModel):
    url: str
    title: str | None = None
    selected_text: str
    citation_format: str | None = None
    citation_text: str | None = None
    custom_format_name: str | None = None
    custom_format_template: str | None = None


def _get_reset_at() -> tuple[str, int]:
    timezone = pytz.timezone("Africa/Kampala")
    now = datetime.now(timezone)
    week_start = datetime.strptime(get_week_start_gmt3(), "%Y-%m-%d")
    week_start = timezone.localize(week_start)
    reset_at = week_start + timedelta(days=7)
    ttl_seconds = max(int((reset_at - now).total_seconds()), 60)
    return reset_at.isoformat(), ttl_seconds


def _iso_week_key(now: datetime) -> str:
    iso_year, iso_week, _ = now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _week_reset_utc(now: datetime) -> tuple[str, int]:
    week_start = now - timedelta(days=now.isoweekday() - 1)
    week_start = datetime(
        week_start.year,
        week_start.month,
        week_start.day,
        tzinfo=now.tzinfo,
    )
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


@router.post("/api/extension/selection")
async def extension_selection(request: Request, payload: ExtensionSelectionRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    if account_type not in PAID_TIERS:
        raise HTTPException(status_code=403, detail="Editor access requires a paid tier.")

    selected_text = (payload.selected_text or "").strip()
    if not selected_text:
        raise HTTPException(status_code=422, detail="Selected text is required.")

    now = datetime.utcnow()
    reset_at, ttl_seconds = _week_reset_utc(now)
    usage_key = f"ext_unlocks:{user_id}:{_iso_week_key(now)}"
    usage_count = int(await request.app.state.redis_get(usage_key) or 0)

    if usage_count >= EXTENSION_EDITOR_WEEKLY_LIMIT:
        raise HTTPException(status_code=429, detail="Extension editor limit reached.")

    citation_id = None
    if payload.citation_format:
        citation_input = CitationInput(
            url=payload.url,
            excerpt=(payload.title or selected_text[:140]).strip(),
            full_text=(payload.citation_text or selected_text).strip(),
            format=payload.citation_format,
            custom_format_name=payload.custom_format_name,
            custom_format_template=payload.custom_format_template,
            metadata={
                "source": "extension",
                "title": payload.title,
                "selected_text": selected_text,
                "accessed_at": now.isoformat(),
            },
        )
        citation_id = await create_citation(user_id, account_type, citation_input)

    now_iso = now.isoformat()
    insert_payload = {
        "user_id": user_id,
        "title": (payload.title or "New clip").strip(),
        "content_delta": {"ops": [{"insert": f"{selected_text}\n"}]},
        "citation_ids": [citation_id] if citation_id else [],
        "created_at": now_iso,
        "updated_at": now_iso,
        "expires_at": _doc_expiration(account_type),
    }

    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/documents",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=insert_payload,
    )

    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create document")

    data = res.json()
    if not data:
        raise HTTPException(status_code=500, detail="Failed to create document")

    if usage_count == 0:
        await request.app.state.redis_expire(usage_key, ttl_seconds)
    await request.app.state.redis_incr(usage_key)
    usage_count += 1

    remaining = max(EXTENSION_EDITOR_WEEKLY_LIMIT - usage_count, 0)
    return {
        "doc_id": data[0].get("id"),
        "editor_url": f"/editor?doc={data[0].get('id')}",
        "citation_id": citation_id,
        "account_type": normalize_account_type(account_type),
        "allowed": True,
        "remaining": remaining,
        "reset_at": reset_at,
    }
