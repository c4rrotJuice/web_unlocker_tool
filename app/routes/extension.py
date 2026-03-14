from datetime import datetime, timedelta, timezone
import hashlib
import os
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator, model_validator

from app.services.entitlements import get_tier_capabilities, normalize_account_type
from app.services.supabase_rest import SupabaseRestRepository
from app.services.IP_usage_limit import get_user_ip
from app.routes.citations import CitationInput, create_citation
from app.routes.editor import _count_docs_in_window, _doc_expiration, _get_account_type, _quota_for_tier, _doc_limit_toast_payload
from app.routes.render import save_unlock_history
from app.services.free_tier_gating import current_week_window, unlock_window_for_tier, week_key


router = APIRouter()

EXTENSION_WEEKLY_LIMIT = 5
EXTENSION_EDITOR_WEEKLY_LIMIT = 500
PAID_TIERS = {"standard", "pro", "dev"}
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


class ExtensionNotePayload(BaseModel):
    id: str | None = None
    title: str | None = None
    highlight_text: str | None = None
    note_body: str | None = None
    source_url: str | None = None
    source_title: str | None = None
    source_author: str | None = None
    source_published_at: str | None = None
    project_id: str | None = None
    citation_id: str | None = None
    tags: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    sources: list[dict] = []
    linked_note_ids: list[str] = []

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_fields(cls, value):
        if not isinstance(value, dict):
            return value
        if value.get("note_body") in (None, ""):
            legacy_body = value.get("body") or value.get("text")
            if isinstance(legacy_body, str):
                value["note_body"] = legacy_body
        return value


class ExtensionNotePatchRequest(BaseModel):
    id: str | None = None
    title: str | None = None
    highlight_text: str | None = None
    note_body: str | None = None
    source_url: str | None = None
    source_title: str | None = None
    source_author: str | None = None
    source_published_at: str | None = None
    project_id: str | None = None
    citation_id: str | None = None
    tags: list[str] | None = None
    updated_at: str | None = None
    sources: list[dict] | None = None
    linked_note_ids: list[str] | None = None


class NoteProjectPayload(BaseModel):
    name: str
    color: str | None = None


def _source_domain(url: str | None) -> str | None:
    candidate = (url or "").strip()
    if not candidate:
        return None
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    return parsed.netloc.lower() or None


def _parse_iso_datetime(value: str | None) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _coerce_note_id(raw_id: str | None) -> str:
    note_id = (raw_id or "").strip()
    if not note_id:
        raise HTTPException(status_code=422, detail="id is required")
    try:
        return str(UUID(note_id))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="id must be a valid UUID") from exc


def _clean_note_body(note_body: str | None, highlight_text: str | None = None) -> str:
    body = (note_body or "").strip() or (highlight_text or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="note_body is required (or provide highlight_text)")
    return body


def _clean_note_tags(tags: list[str] | None) -> list[str]:
    cleaned = []
    for tag_id in tags or []:
        try:
            cleaned.append(str(UUID(str(tag_id))))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="tags must contain UUIDs") from exc
    return cleaned


def _clean_note_sources(sources: list[dict] | None) -> list[dict]:
    cleaned: list[dict] = []
    seen: set[str] = set()
    for src in sources or []:
        if not isinstance(src, dict):
            continue
        url = (src.get("url") or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            continue
        dedupe_key = url.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        parsed_title = (src.get("title") or "").strip() or None
        host = _source_domain(url)
        attached_at = _parse_iso_datetime(src.get("attached_at")) or datetime.utcnow()
        cleaned.append(
            {
                "url": url,
                "title": parsed_title,
                "hostname": (src.get("hostname") or host or "").strip() or host,
                "attached_at": attached_at.isoformat(),
            }
        )
    return cleaned


def _clean_linked_note_ids(linked_note_ids: list[str] | None, *, note_id: str | None = None) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for raw in linked_note_ids or []:
        try:
            normalized = str(UUID(str(raw)))
        except ValueError:
            continue
        if note_id and normalized == note_id:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


async def _replace_note_sources(user_id: str, note_id: str, sources: list[dict]):
    delete_res = await supabase_repo.delete(
        "note_sources",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{note_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if delete_res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=500, detail="Failed to update note sources")
    if not sources:
        return
    rows = [
        {
            "note_id": note_id,
            "user_id": user_id,
            "url": src.get("url"),
            "title": src.get("title"),
            "hostname": src.get("hostname"),
            "attached_at": src.get("attached_at"),
        }
        for src in sources
    ]
    insert_res = await supabase_repo.post(
        "note_sources",
        json=rows,
        headers=supabase_repo.headers(prefer="return=minimal"),
    )
    if insert_res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to update note sources")


async def _replace_note_links(user_id: str, note_id: str, linked_note_ids: list[str]):
    delete_res = await supabase_repo.delete(
        "note_links",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{note_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if delete_res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=500, detail="Failed to update linked notes")
    if not linked_note_ids:
        return
    rows = [{"note_id": note_id, "linked_note_id": linked_id, "user_id": user_id} for linked_id in linked_note_ids]
    insert_res = await supabase_repo.post(
        "note_links",
        json=rows,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
    )
    if insert_res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to update linked notes")


async def _enrich_notes_with_sources_and_links(user_id: str, notes: list[dict]) -> list[dict]:
    if not notes:
        return notes
    note_ids = [row.get("id") for row in notes if row.get("id")]
    if not note_ids:
        return notes
    id_filter = f"in.({','.join(note_ids)})"
    sources_res = await supabase_repo.get(
        "note_sources",
        params={"user_id": f"eq.{user_id}", "note_id": id_filter, "select": "note_id,url,title,hostname,attached_at", "order": "attached_at.desc"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    links_res = await supabase_repo.get(
        "note_links",
        params={"user_id": f"eq.{user_id}", "note_id": id_filter, "select": "note_id,linked_note_id,created_at", "order": "created_at.desc"},
        headers=supabase_repo.headers(include_content_type=False),
    )

    sources_by_note: dict[str, list[dict]] = {}
    if sources_res.status_code == 200:
        for row in sources_res.json() or []:
            nid = row.get("note_id")
            if not nid:
                continue
            sources_by_note.setdefault(nid, []).append(
                {
                    "url": row.get("url"),
                    "title": row.get("title"),
                    "hostname": row.get("hostname"),
                    "attached_at": row.get("attached_at"),
                }
            )

    links_by_note: dict[str, list[str]] = {}
    if links_res.status_code == 200:
        for row in links_res.json() or []:
            nid = row.get("note_id")
            linked = row.get("linked_note_id")
            if not nid or not linked:
                continue
            links_by_note.setdefault(nid, []).append(linked)

    for note in notes:
        nid = note.get("id")
        note["sources"] = sources_by_note.get(nid, [])
        note["linked_note_ids"] = links_by_note.get(nid, [])
    return notes


async def _upsert_note_tags_for_note(user_id: str, note_id: str, tag_ids: list[str]):
    delete_existing = await supabase_repo.delete(
        "note_note_tags",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{note_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if delete_existing.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to update note tags")

    if not tag_ids:
        return

    rows = [{"note_id": note_id, "tag_id": tag_id, "user_id": user_id} for tag_id in tag_ids]
    insert_join = await supabase_repo.post(
        "note_note_tags",
        json=rows,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
    )
    if insert_join.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to update note tags")


async def _assert_note_exists(user_id: str, note_id: str) -> None:
    res = await supabase_repo.get(
        "notes",
        params={"id": f"eq.{note_id}", "user_id": f"eq.{user_id}", "select": "id", "limit": 1},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to validate note")
    if not (res.json() or []):
        raise HTTPException(status_code=404, detail="Note not found")


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

    if get_tier_capabilities(account_type).has_unlock_limits and usage_count >= EXTENSION_EDITOR_WEEKLY_LIMIT:
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

    if get_tier_capabilities(account_type).has_unlock_limits:
        if usage_count == 0:
            await request.app.state.redis_expire(usage_key, ttl_seconds)
        await request.app.state.redis_incr(usage_key)
        usage_count += 1
        remaining = max(EXTENSION_EDITOR_WEEKLY_LIMIT - usage_count, 0)
    else:
        remaining = -1

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


@router.post("/api/notes")
async def create_note(request: Request, payload: ExtensionNotePayload):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    note_id = _coerce_note_id(payload.id) if payload.id else str(uuid4())
    note_body = _clean_note_body(payload.note_body, payload.highlight_text)
    tag_ids = _clean_note_tags(payload.tags)
    created_at = _parse_iso_datetime(payload.created_at) or datetime.utcnow()
    updated_at = _parse_iso_datetime(payload.updated_at) or datetime.utcnow()
    source_published_at = _parse_iso_datetime(payload.source_published_at)
    citation_id = _coerce_note_id(payload.citation_id) if payload.citation_id else None
    sources = _clean_note_sources(payload.sources)
    linked_note_ids = _clean_linked_note_ids(payload.linked_note_ids, note_id=note_id)

    insert_payload = {
        "id": note_id,
        "user_id": user_id,
        "title": (payload.title or "").strip() or None,
        "highlight_text": payload.highlight_text,
        "note_body": note_body,
        "source_url": (payload.source_url or "").strip() or None,
        "source_title": (payload.source_title or "").strip() or None,
        "source_author": (payload.source_author or "").strip() or None,
        "source_published_at": source_published_at.isoformat() if source_published_at else None,
        "source_domain": _source_domain(payload.source_url),
        "project_id": payload.project_id,
        "citation_id": citation_id,
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
    }

    res = await supabase_repo.post(
        "notes",
        json=insert_payload,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=representation"),
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to sync note")

    await _upsert_note_tags_for_note(user_id, note_id, tag_ids)
    await _replace_note_sources(user_id, note_id, sources)
    await _replace_note_links(user_id, note_id, linked_note_ids)
    return {"ok": True, "note_id": note_id}


@router.get("/api/notes")
async def list_notes(
    request: Request,
    tag: str | None = None,
    project: str | None = None,
    source: str | None = None,
    search: str | None = None,
    citation_id: str | None = None,
    archived: bool = False,
    include_archived: bool = False,
    sort: str = "desc",
    limit: int = 100,
    offset: int = 0,
):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    order = "created_at.asc" if sort == "asc" else "created_at.desc"
    normalized_limit = min(max(limit, 1), 500)
    normalized_offset = max(offset, 0)
    params = {
        "user_id": f"eq.{user_id}",
        "order": order,
        "limit": str(normalized_limit),
        "offset": str(normalized_offset),
        "select": "id,title,highlight_text,note_body,source_url,source_domain,source_title,source_author,source_published_at,project_id,citation_id,archived_at,created_at,updated_at",
    }

    if include_archived:
        pass
    elif archived:
        params["archived_at"] = "not.is.null"
    else:
        params["archived_at"] = "is.null"

    if citation_id:
        params["citation_id"] = f"eq.{_coerce_note_id(citation_id)}"

    if search and search.strip():
        term = search.strip().replace(",", " ")
        params["search_vector"] = f"plfts.{term}"

    if source:
        params["source_domain"] = f"ilike.*{source.strip().lower()}*"

    if project:
        project_res = await supabase_repo.get(
            "note_projects",
            params={
                "user_id": f"eq.{user_id}",
                "name": f"ilike.*{project.strip()}*",
                "select": "id",
            },
            headers=supabase_repo.headers(include_content_type=False),
        )
        project_rows = project_res.json() if project_res.status_code == 200 else []
        if not project_rows:
            return {"ok": True, "total_count": 0, "notes": []}
        project_ids = ",".join([row.get("id") for row in project_rows if row.get("id")])
        params["project_id"] = f"in.({project_ids})"

    res = await supabase_repo.get(
        "notes",
        params=params,
        headers=supabase_repo.headers(include_content_type=False, prefer="count=exact"),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load notes")

    notes = res.json() or []
    notes = await _enrich_notes_with_sources_and_links(user_id, notes)

    if tag:
        tag_res = await supabase_repo.get(
            "note_tags",
            params={
                "user_id": f"eq.{user_id}",
                "name": f"ilike.*{tag.strip()}*",
                "select": "id",
            },
            headers=supabase_repo.headers(include_content_type=False),
        )
        tag_rows = tag_res.json() if tag_res.status_code == 200 else []
        tag_ids = [row.get("id") for row in tag_rows if row.get("id")]
        if not tag_ids:
            return {"ok": True, "total_count": 0, "notes": []}
        tag_join = await supabase_repo.get(
            "note_note_tags",
            params={
                "user_id": f"eq.{user_id}",
                "tag_id": f"in.({','.join(tag_ids)})",
                "select": "note_id",
            },
            headers=supabase_repo.headers(include_content_type=False),
        )
        if tag_join.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to load notes")
        allowed_ids = {row.get("note_id") for row in (tag_join.json() or []) if row.get("note_id")}
        notes = [note for note in notes if note.get("id") in allowed_ids]

    total_count = len(notes)
    content_range = res.headers.get("content-range") if hasattr(res, "headers") else None
    if content_range and "/" in content_range:
        try:
            total_count = int(content_range.split("/")[-1])
        except (TypeError, ValueError):
            total_count = len(notes)

    return {"ok": True, "total_count": total_count, "notes": notes}


@router.get("/api/note-projects")
async def list_note_projects(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    res = await supabase_repo.get(
        "note_projects",
        params={
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": 200,
            "select": "id,name,color,created_at,updated_at",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load note projects")
    return res.json() or []


@router.post("/api/note-projects")
async def create_note_project(request: Request, payload: NoteProjectPayload):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    res = await supabase_repo.post(
        "note_projects",
        json={"user_id": user_id, "name": name[:120], "color": (payload.color or "").strip() or None},
        headers=supabase_repo.headers(prefer="return=representation"),
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create note project")
    rows = res.json() or []
    return rows[0] if rows else {"ok": True}


@router.delete("/api/note-projects/{project_id}")
async def delete_note_project(request: Request, project_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        normalized_id = str(UUID(project_id))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="project_id must be a valid UUID") from exc

    res = await supabase_repo.delete(
        "note_projects",
        params={"id": f"eq.{normalized_id}", "user_id": f"eq.{user_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to delete note project")
    return {"ok": True, "id": normalized_id}


@router.patch("/api/notes")
async def update_note(request: Request, payload: ExtensionNotePatchRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    note_id = _coerce_note_id(payload.id)
    tag_ids = _clean_note_tags(payload.tags)
    updated_at = _parse_iso_datetime(payload.updated_at) or datetime.utcnow()
    source_published_at = _parse_iso_datetime(payload.source_published_at) if payload.source_published_at is not None else None
    sources = _clean_note_sources(payload.sources) if payload.sources is not None else None
    linked_note_ids = _clean_linked_note_ids(payload.linked_note_ids, note_id=note_id) if payload.linked_note_ids is not None else None

    patch_payload = {"updated_at": updated_at.isoformat()}
    if payload.title is not None:
        patch_payload["title"] = (payload.title or "").strip() or None
    if payload.highlight_text is not None:
        patch_payload["highlight_text"] = payload.highlight_text
    if payload.note_body is not None:
        patch_payload["note_body"] = _clean_note_body(payload.note_body, payload.highlight_text)
    if payload.source_url is not None:
        patch_payload["source_url"] = (payload.source_url or "").strip() or None
        patch_payload["source_domain"] = _source_domain(payload.source_url)
    if payload.source_title is not None:
        patch_payload["source_title"] = (payload.source_title or "").strip() or None
    if payload.source_author is not None:
        patch_payload["source_author"] = (payload.source_author or "").strip() or None
    if payload.source_published_at is not None:
        patch_payload["source_published_at"] = source_published_at.isoformat() if source_published_at else None
    if payload.project_id is not None:
        patch_payload["project_id"] = payload.project_id
    if payload.citation_id is not None:
        patch_payload["citation_id"] = _coerce_note_id(payload.citation_id) if payload.citation_id else None
    res = await supabase_repo.patch(
        "notes",
        params={"id": f"eq.{note_id}", "user_id": f"eq.{user_id}"},
        json=patch_payload,
        headers=supabase_repo.headers(prefer="return=representation"),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to sync note")
    if not res.json():
        raise HTTPException(status_code=404, detail="Note not found")

    await _upsert_note_tags_for_note(user_id, note_id, tag_ids)
    if sources is not None:
        await _replace_note_sources(user_id, note_id, sources)
    if linked_note_ids is not None:
        await _replace_note_links(user_id, note_id, linked_note_ids)
    return {"ok": True, "note_id": note_id}


@router.delete("/api/notes/{note_id}")
async def delete_note(request: Request, note_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    normalized_note_id = _coerce_note_id(note_id)
    res = await supabase_repo.delete(
        "notes",
        params={"id": f"eq.{normalized_note_id}", "user_id": f"eq.{user_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to delete note")
    return {"ok": True, "note_id": normalized_note_id}


@router.post("/api/notes/{note_id}/archive")
async def archive_note(request: Request, note_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    normalized_note_id = _coerce_note_id(note_id)
    res = await supabase_repo.patch(
        "notes",
        params={"id": f"eq.{normalized_note_id}", "user_id": f"eq.{user_id}"},
        json={"archived_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()},
        headers=supabase_repo.headers(prefer="return=representation"),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to archive note")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True, "note_id": normalized_note_id, "archived": True}


@router.post("/api/notes/{note_id}/restore")
async def restore_note(request: Request, note_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    normalized_note_id = _coerce_note_id(note_id)
    now_iso = datetime.utcnow().isoformat()
    res = await supabase_repo.patch(
        "notes",
        params={"id": f"eq.{normalized_note_id}", "user_id": f"eq.{user_id}"},
        json={"archived_at": None, "updated_at": now_iso},
        headers=supabase_repo.headers(prefer="return=representation"),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to restore note")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True, "note_id": normalized_note_id, "archived": False}


@router.post("/api/notes/{note_id}/citation")
async def create_citation_from_note(request: Request, note_id: str, format: str = "mla"):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    normalized_note_id = _coerce_note_id(note_id)
    note_res = await supabase_repo.get(
        "notes",
        params={
            "id": f"eq.{normalized_note_id}",
            "user_id": f"eq.{user_id}",
            "limit": 1,
            "select": "id,title,highlight_text,note_body,source_url,source_title,citation_id",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if note_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load note")
    rows = note_res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")

    note = rows[0]
    if note.get("citation_id"):
        return {"ok": True, "note_id": normalized_note_id, "citation_id": note.get("citation_id"), "created": False}

    account_type = await _get_account_type(request, user_id)
    source_url = (note.get("source_url") or "https://writior.local/notes").strip()
    full_text = (note.get("highlight_text") or note.get("note_body") or "").strip() or (note.get("title") or "Research note")
    excerpt = (note.get("source_title") or note.get("title") or full_text[:140]).strip()[:240]

    citation_input = CitationInput(
        url=source_url,
        excerpt=excerpt,
        full_text=full_text,
        format=format,
        metadata={"source": "note", "note_id": normalized_note_id, "source_title": note.get("source_title")},
    )
    citation_id = await create_citation(user_id, account_type, citation_input)

    patch_res = await supabase_repo.patch(
        "notes",
        params={"id": f"eq.{normalized_note_id}", "user_id": f"eq.{user_id}"},
        json={"citation_id": citation_id, "updated_at": datetime.utcnow().isoformat()},
        headers=supabase_repo.headers(prefer="return=minimal"),
    )
    if patch_res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to link citation to note")
    return {"ok": True, "note_id": normalized_note_id, "citation_id": citation_id, "created": True}


@router.get("/api/notes/{note_id}/sources")
async def get_note_sources(request: Request, note_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    normalized_note_id = _coerce_note_id(note_id)
    await _assert_note_exists(user_id, normalized_note_id)
    res = await supabase_repo.get(
        "note_sources",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{normalized_note_id}", "select": "url,title,hostname,attached_at", "order": "attached_at.desc"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code not in (200, 404):
        raise HTTPException(status_code=500, detail="Failed to load note sources")
    return {"ok": True, "note_id": normalized_note_id, "sources": res.json() if res.status_code == 200 else []}


@router.post("/api/notes/{note_id}/sources")
async def attach_note_source(request: Request, note_id: str, payload: dict):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    normalized_note_id = _coerce_note_id(note_id)
    await _assert_note_exists(user_id, normalized_note_id)
    source_list = _clean_note_sources([payload])
    if not source_list:
        raise HTTPException(status_code=422, detail="Valid http/https source URL is required")
    existing = await supabase_repo.get(
        "note_sources",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{normalized_note_id}", "select": "url,title,hostname,attached_at"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    current_sources = existing.json() if existing.status_code == 200 else []
    deduped = _clean_note_sources([*current_sources, *source_list])
    await _replace_note_sources(user_id, normalized_note_id, deduped)
    return {"ok": True, "note_id": normalized_note_id, "sources": deduped}


@router.post("/api/notes/{note_id}/links")
async def link_note_to_notes(request: Request, note_id: str, payload: dict):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    normalized_note_id = _coerce_note_id(note_id)
    await _assert_note_exists(user_id, normalized_note_id)
    raw_ids = payload.get("linked_note_ids") if isinstance(payload, dict) else None
    linked_note_ids = _clean_linked_note_ids(raw_ids, note_id=normalized_note_id)
    await _replace_note_links(user_id, normalized_note_id, linked_note_ids)
    return {"ok": True, "note_id": normalized_note_id, "linked_note_ids": linked_note_ids}
