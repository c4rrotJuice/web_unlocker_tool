from datetime import datetime, timedelta, timezone
import hashlib
import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from app.services.entitlements import normalize_account_type
from app.services.supabase_rest import SupabaseRestRepository
from app.services.IP_usage_limit import get_user_ip
from app.routes.citations import CitationInput, create_citation
from app.routes.editor import _count_docs_in_window, _doc_expiration, _get_account_type, _quota_for_tier, _doc_limit_toast_payload
from app.routes.render import save_unlock_history
from app.services.free_tier_gating import current_week_window, unlock_window_for_tier, week_key


router = APIRouter()

EXTENSION_WEEKLY_LIMIT = 5
EXTENSION_EDITOR_WEEKLY_LIMIT = 500
PAID_TIERS = {"standard", "pro"}
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_repo = SupabaseRestRepository(base_url=SUPABASE_URL, service_role_key=SUPABASE_KEY)
ANON_USAGE_PAIR_RATE_LIMIT_PER_MINUTE = 10


class ExtensionPermitRequest(BaseModel):
    url: str | None = None
    dry_run: bool = False


class ExtensionUsageEventRequest(BaseModel):
    url: str
    event_id: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        url = (value or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("url must be http/https")
        if len(url) > 2048:
            raise ValueError("url is too long")
        return url

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        event_id = (value or "").strip()
        if not event_id:
            raise ValueError("event_id is required")
        try:
            UUID(event_id)
        except ValueError as exc:
            raise ValueError("event_id must be a valid UUID") from exc
        return event_id


class ExtensionSelectionRequest(BaseModel):
    url: str
    title: str | None = None
    selected_text: str
    citation_format: str | None = None
    citation_text: str | None = None
    custom_format_name: str | None = None
    custom_format_template: str | None = None


def _get_reset_at() -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    _, reset_at = current_week_window(now)
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


def _is_valid_anon_usage_id(value: str | None) -> bool:
    anon_id = (value or "").strip()
    if not anon_id:
        return False
    try:
        UUID(anon_id)
    except ValueError:
        return False
    return True


def _hash_ip(ip: str) -> str:
    return hashlib.sha256((ip or "").encode("utf-8")).hexdigest()


async def _enforce_anon_pair_rate_limit(request: Request, anon_usage_id: str, ip_hash: str) -> None:
    minute_key = datetime.utcnow().strftime('%Y-%m-%dT%H:%M')
    rate_limit_key = f"extension_anon_pair_rate:{ip_hash}:{anon_usage_id}:{minute_key}"
    current_minute_usage = int(await request.app.state.redis_get(rate_limit_key) or 0)
    if current_minute_usage >= ANON_USAGE_PAIR_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many extension guest requests.")

    await request.app.state.redis_incr(rate_limit_key)
    if current_minute_usage == 0:
        await request.app.state.redis_expire(rate_limit_key, 120)


async def _enforce_anon_id_binding(request: Request, anon_usage_id: str, ip_hash: str) -> None:
    bind_key = f"extension_anon_binding:{ip_hash}:{week_key()}"
    existing_anon_id = await request.app.state.redis_get(bind_key)
    if existing_anon_id and existing_anon_id != anon_usage_id:
        raise HTTPException(status_code=429, detail="Anonymous identity mismatch for this IP.")

    if not existing_anon_id:
        await request.app.state.redis_set(bind_key, anon_usage_id)
        _, ttl_seconds = _get_reset_at()
        await request.app.state.redis_expire(bind_key, ttl_seconds)


def _get_valid_anon_usage_id(request: Request) -> str:
    anon_usage_id = request.headers.get("X-Extension-Anon-Id")
    if not _is_valid_anon_usage_id(anon_usage_id):
        raise HTTPException(status_code=422, detail="X-Extension-Anon-Id must be a valid UUID.")
    return anon_usage_id


@router.post("/api/extension/unlock-permit")
async def extension_unlock_permit(request: Request, payload: ExtensionPermitRequest):
    user_id = request.state.user_id

    account_type = normalize_account_type(request.state.account_type)
    response_account_type = "freemium" if account_type == "free" else account_type
    usage_period = "week"

    if not user_id:
        anon_usage_id = _get_valid_anon_usage_id(request)
        ip_hash = _hash_ip(get_user_ip(request))
        await _enforce_anon_id_binding(request, anon_usage_id, ip_hash)
        await _enforce_anon_pair_rate_limit(request, anon_usage_id, ip_hash)

        reset_at, ttl_seconds = _get_reset_at()
        usage_key = f"extension_usage_week:anonymous:{anon_usage_id}:{week_key()}"
        usage_limit = EXTENSION_WEEKLY_LIMIT
        usage_count = int(await request.app.state.redis_get(usage_key) or 0)

        allowed = usage_count < usage_limit
        if allowed and not payload.dry_run:
            await request.app.state.redis_incr(usage_key)
            if usage_count == 0:
                await request.app.state.redis_expire(usage_key, ttl_seconds)
            usage_count += 1

        remaining = max(usage_limit - usage_count, 0)
        reason = "ok" if allowed else "limit_reached"

        response_body = {
            "allowed": allowed,
            "remaining": remaining,
            "reset_at": reset_at,
            "reason": reason,
            "account_type": "anonymous",
            "usage_period": usage_period,
        }
        return response_body

    unlock_window = unlock_window_for_tier(account_type, user_id)
    if unlock_window is None:
        return {
            "allowed": True,
            "remaining": -1,
            "reset_at": None,
            "reason": "ok",
            "account_type": response_account_type,
            "usage_period": "unlimited",
        }

    usage_count = int(await request.app.state.redis_get(unlock_window.key) or 0)

    allowed = usage_count < unlock_window.limit
    if allowed and not payload.dry_run:
        await request.app.state.redis_incr(unlock_window.key)
        if usage_count == 0:
            await request.app.state.redis_expire(unlock_window.key, unlock_window.ttl_seconds)
        usage_count += 1

    remaining = max(unlock_window.limit - usage_count, 0)
    reason = "ok" if allowed else "limit_reached"

    return {
        "allowed": allowed,
        "remaining": remaining,
        "reset_at": unlock_window.reset_at,
        "reason": reason,
        "account_type": response_account_type,
        "usage_period": unlock_window.usage_period,
    }


@router.post("/api/extension/selection")
async def extension_selection(request: Request, payload: ExtensionSelectionRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)

    selected_text = (payload.selected_text or "").strip()
    if not selected_text:
        raise HTTPException(status_code=422, detail="Selected text is required.")

    now = datetime.utcnow()
    reset_at, ttl_seconds = _week_reset_utc(now)
    usage_key = f"ext_unlocks:{user_id}:{_iso_week_key(now)}"
    usage_count = int(await request.app.state.redis_get(usage_key) or 0)

    if usage_count >= EXTENSION_EDITOR_WEEKLY_LIMIT:
        raise HTTPException(status_code=429, detail="Extension editor limit reached.")

    quota = _quota_for_tier(account_type, now)
    if quota:
        used = await _count_docs_in_window(user_id, quota["window_start"], quota["window_end"])
        if used >= quota["limit"]:
            return {
                "allowed": False,
                "reason": "doc_limit_reached",
                "account_type": normalize_account_type(account_type),
                "editor_url": "/editor?quota=max_docs",
                "toast": _doc_limit_toast_payload(account_type, used, quota["limit"], quota["reset_at"])["toast"],
                "quota": {
                    "used": used,
                    "limit": quota["limit"],
                    "reset_at": quota["reset_at"],
                    "window_start": quota["window_start"].isoformat(),
                    "window_end": quota["window_end"].isoformat(),
                },
            }

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

    res = await supabase_repo.post(
        "documents",
        headers={
            **supabase_repo.headers(prefer="return=representation"),
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


@router.post("/api/extension/usage-event")
async def extension_usage_event(request: Request, payload: ExtensionUsageEventRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    rate_limit_key = f"extension_usage_event_rate:{user_id}:{datetime.utcnow().strftime('%Y-%m-%dT%H:%M')}"
    current_minute_usage = int(await request.app.state.redis_get(rate_limit_key) or 0)
    if current_minute_usage >= 30:
        raise HTTPException(status_code=429, detail="Too many extension usage events.")

    save_result = await save_unlock_history(
        user_id,
        payload.url,
        "",
        request.app.state.http_session,
        source="extension",
        event_id=payload.event_id,
    )

    if save_result == "failed":
        raise HTTPException(status_code=503, detail="Failed to record extension usage event.")

    await request.app.state.redis_incr(rate_limit_key)
    if current_minute_usage == 0:
        await request.app.state.redis_expire(rate_limit_key, 120)

    return {"ok": True, "deduped": save_result == "duplicate"}
