from __future__ import annotations

from datetime import datetime
import logging
import os
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.routes.http import http_client
from app.services.citation_domain import (
    ExtractionPayload,
    RENDER_VERSION,
    SUPPORTED_RENDER_KINDS,
    SUPPORTED_STYLES,
    build_api_citation_record,
    compute_citation_version,
    generate_render_bundle,
    legacy_metadata_to_payload,
    normalize_citation_payload,
)
from app.services.citation_templates import render_template, validate_template
from app.services.entitlements import get_tier_capabilities, normalize_account_type
from app.services.free_tier_gating import allowed_citation_formats
from app.services.metrics import metrics, record_dependency_call_async
from app.services.supabase_rest import SupabaseRestRepository

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_repo = SupabaseRestRepository(base_url=SUPABASE_URL, service_role_key=SUPABASE_KEY)


class CitationInput(BaseModel):
    url: str
    excerpt: str
    format: str | None = None
    metadata: dict[str, Any] | None = None
    extraction_payload: dict[str, Any] | None = None
    locator: dict[str, Any] = Field(default_factory=dict)
    quote: str | None = None
    annotation: str | None = None
    full_text: str | None = None
    inline_citation: str | None = None
    full_citation: str | None = None
    custom_format_name: str | None = None
    custom_format_template: str | None = None


class CitationTemplateInput(BaseModel):
    name: str
    template: str


_SAFE_CITATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _quote_id_for_supabase(raw_id: str) -> str:
    if not _SAFE_CITATION_ID_PATTERN.fullmatch(raw_id):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CITATION_IDS_INVALID",
                "message": "Citation ids must be alphanumeric (plus '-' or '_').",
            },
        )

    if raw_id.isdigit():
        return raw_id
    return f'"{raw_id}"'


def _response_error_text(response) -> str:
    try:
        body = response.json()
    except Exception:
        return ""
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or "")
    if isinstance(body, list):
        return " ".join(str(item) for item in body)
    return str(body)


def _is_schema_missing_response(response) -> bool:
    if response.status_code not in (400, 404):
        return False
    detail = _response_error_text(response).lower()
    return any(token in detail for token in ("column", "relation", "table", "schema cache"))


def _upstream_failure(
    *,
    request: Request,
    route_name: str,
    status_code: int,
    body_snippet: str,
    code: str,
    message: str,
) -> None:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.error(
        "%s upstream_failed request_id=%s status=%s body_snippet=%s",
        route_name,
        request_id,
        status_code,
        body_snippet,
    )
    metrics.inc("api.upstream.error_count")
    raise HTTPException(status_code=503, detail={"code": code, "message": message, "request_id": request_id})


def _pro_only_for_templates(account_type: str):
    caps = get_tier_capabilities(account_type)
    if not caps.can_use_custom_citation_templates:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CITATION_TEMPLATE_PRO_ONLY",
                "message": "Custom citation templates are available on Pro only.",
                "toast": "Upgrade to Pro to use custom citation templates.",
            },
        )


def _build_extraction_payload(citation: CitationInput) -> ExtractionPayload:
    if citation.extraction_payload:
        payload = dict(citation.extraction_payload)
        raw_metadata = payload.get("raw_metadata") if isinstance(payload.get("raw_metadata"), dict) else {}
        raw_metadata = {
            **raw_metadata,
            "excerpt": citation.excerpt,
            "quote": citation.quote,
            "annotation": citation.annotation,
            "locator": citation.locator,
        }
        payload["raw_metadata"] = raw_metadata
        return ExtractionPayload.model_validate(payload)

    metadata = {
        **(citation.metadata or {}),
        "excerpt": citation.excerpt,
        "quote": citation.quote or citation.full_text or citation.excerpt,
        "annotation": citation.annotation,
        "locator": citation.locator,
    }
    return legacy_metadata_to_payload(
        url=citation.url,
        excerpt=citation.excerpt,
        metadata=metadata,
        full_text=citation.full_text,
    )


async def _legacy_create_citation_row(user_id: str, citation: CitationInput, normalized: dict[str, Any]) -> str:
    source = normalized["source"]
    context = normalized["context"]
    style = (citation.format or "mla").strip().lower()
    render_bundle = generate_render_bundle(source, context, styles=sorted(SUPPORTED_STYLES), render_kinds=["inline", "bibliography"])
    render_cache = [
        {
            "style": render_style,
            "inline_citation": outputs["inline"],
            "full_citation": outputs["bibliography"],
            "source_version": source["source_version"],
            "citation_version": context["citation_version"],
            "render_version": RENDER_VERSION,
            "rendered_at": datetime.utcnow().isoformat(),
        }
        for render_style, outputs in render_bundle["renders"].items()
    ]
    style_renders = render_bundle["renders"].get(style) or render_bundle["renders"]["mla"]

    response = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/citations",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json={
            "user_id": user_id,
            "url": source["canonical_url"] or source["page_url"],
            "excerpt": context["excerpt"],
            "inline_citation": style_renders["inline"],
            "full_citation": style_renders["bibliography"],
            "full_text": style_renders["bibliography"],
            "format": style,
            "metadata": {
                **(source.get("metadata") or {}),
                "locator": context["locator"],
                "annotation": context["annotation"],
                "quote": context["quote"],
                "source_fingerprint": source["fingerprint"],
                "source_version": source["source_version"],
            },
            "source_fingerprint": source["fingerprint"],
            "source_version": source["source_version"],
            "render_cache": render_cache,
            "cited_at": datetime.utcnow().isoformat(),
        },
    )
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to add citation")
    rows = response.json() or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to add citation")
    return rows[0]["id"]


async def _get_source_by_fingerprint(fingerprint: str) -> dict[str, Any] | None:
    response = await supabase_repo.get(
        "sources",
        params={"fingerprint": f"eq.{fingerprint}", "select": "*", "limit": 1},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if response.status_code == 200:
        rows = response.json() or []
        if rows:
            return rows[0]
    if _is_schema_missing_response(response):
        return None
    if response.status_code not in (200, 404):
        raise HTTPException(status_code=500, detail="Failed to load source metadata")
    return None


async def _upsert_source(source: dict[str, Any]) -> dict[str, Any] | None:
    existing = await _get_source_by_fingerprint(source["fingerprint"])
    if existing:
        return existing

    response = await supabase_repo.post(
        "sources",
        headers=supabase_repo.headers(prefer="return=representation"),
        json={
            "fingerprint": source["fingerprint"],
            "title": source["title"],
            "source_type": source["source_type"],
            "authors": source["authors"],
            "container_title": source["container_title"],
            "publisher": source["publisher"],
            "issued_date": source["issued"],
            "identifiers": source["identifiers"],
            "canonical_url": source["canonical_url"],
            "page_url": source["page_url"],
            "metadata": source["metadata"],
            "raw_extraction": source["raw_extraction"],
            "normalization_version": source["normalization_version"],
            "source_version": source["source_version"],
        },
    )
    if _is_schema_missing_response(response):
        return None
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to store source metadata")
    rows = response.json() or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to store source metadata")
    return rows[0]


async def _store_render_cache(citation_instance_id: str, source_id: str, render_bundle: dict[str, Any]):
    await supabase_repo.delete(
        "citation_renders",
        params={"citation_instance_id": f"eq.{citation_instance_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )

    rows = []
    for style, outputs in render_bundle["renders"].items():
        for render_kind, rendered_text in outputs.items():
            rows.append(
                {
                    "citation_instance_id": citation_instance_id,
                    "source_id": source_id,
                    "style": style,
                    "render_kind": render_kind,
                    "rendered_text": rendered_text,
                    "cache_key": f"{render_bundle['source_version']}:{render_bundle['citation_version']}:{RENDER_VERSION}:{style}:{render_kind}",
                    "source_version": render_bundle["source_version"],
                    "citation_version": render_bundle["citation_version"],
                    "render_version": RENDER_VERSION,
                },
            )
    if not rows:
        return

    response = await supabase_repo.post(
        "citation_renders",
        headers=supabase_repo.headers(prefer="return=minimal"),
        json=rows,
    )
    if response.status_code not in (200, 201, 204) and not _is_schema_missing_response(response):
        raise HTTPException(status_code=500, detail="Failed to store citation renders")


async def _create_citation_instance_row(
    *,
    user_id: str,
    source_row: dict[str, Any],
    normalized: dict[str, Any],
) -> dict[str, Any] | None:
    context = normalized["context"]
    response = await supabase_repo.post(
        "citation_instances",
        headers=supabase_repo.headers(prefer="return=representation"),
        json={
            "source_id": source_row["id"],
            "user_id": user_id,
            "locator": context["locator"],
            "quote_text": context["quote"],
            "excerpt": context["excerpt"],
            "annotation": context["annotation"],
            "citation_version": context["citation_version"],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        },
    )
    if _is_schema_missing_response(response):
        return None
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create citation instance")
    rows = response.json() or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create citation instance")
    row = rows[0]
    row["context"] = context
    return row


def _source_from_row(source_row: dict[str, Any]) -> dict[str, Any]:
    metadata = source_row.get("metadata") or {}
    authors = source_row.get("authors") or []
    issued = source_row.get("issued_date") or {}
    return {
        "id": source_row.get("id"),
        "title": source_row.get("title"),
        "title_case": metadata.get("title_case") or source_row.get("title"),
        "sentence_case": metadata.get("sentence_case") or source_row.get("title"),
        "source_type": source_row.get("source_type") or metadata.get("source_type") or "webpage",
        "authors": authors,
        "author": metadata.get("author") or (authors[0].get("fullName") if authors else ""),
        "container_title": source_row.get("container_title"),
        "publisher": source_row.get("publisher"),
        "site_name": metadata.get("siteName") or metadata.get("site_name") or source_row.get("publisher"),
        "issued": issued,
        "identifiers": source_row.get("identifiers") or {},
        "canonical_url": source_row.get("canonical_url"),
        "page_url": source_row.get("page_url"),
        "metadata": metadata,
        "raw_extraction": source_row.get("raw_extraction") or {},
        "normalization_version": source_row.get("normalization_version"),
        "metadata_schema_version": metadata.get("metadata_schema_version"),
        "fingerprint": source_row.get("fingerprint"),
        "source_version": source_row.get("source_version"),
    }


def _context_from_instance_row(instance_row: dict[str, Any]) -> dict[str, Any]:
    locator = instance_row.get("locator") or {}
    context = {
        "quote": instance_row.get("quote_text") or "",
        "excerpt": instance_row.get("excerpt") or instance_row.get("quote_text") or "",
        "annotation": instance_row.get("annotation") or "",
        "locator": locator,
    }
    context["citation_version"] = instance_row.get("citation_version") or compute_citation_version(context)
    return context


async def _fetch_renders(instance_ids: list[str]) -> dict[str, dict[str, dict[str, str]]]:
    if not instance_ids:
        return {}
    response = await supabase_repo.get(
        "citation_renders",
        params={
            "citation_instance_id": f"in.({','.join(instance_ids)})",
            "select": "citation_instance_id,style,render_kind,rendered_text",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if response.status_code != 200:
        return {}
    rows = response.json() or []
    grouped: dict[str, dict[str, dict[str, str]]] = {}
    for row in rows:
        grouped.setdefault(row["citation_instance_id"], {}).setdefault(row["style"], {})[row["render_kind"]] = row["rendered_text"]
    return grouped


async def _fetch_sources_by_ids(source_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not source_ids:
        return {}
    response = await supabase_repo.get(
        "sources",
        params={"id": f"in.({','.join(source_ids)})", "select": "*"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load source metadata")
    return {row["id"]: row for row in (response.json() or []) if row.get("id")}


def _record_from_new_rows(instance_row: dict[str, Any], source_row: dict[str, Any], renders: dict[str, dict[str, str]], preferred_style: str | None = None) -> dict[str, Any]:
    source = _source_from_row(source_row)
    context = _context_from_instance_row(instance_row)
    render_bundle = {
        "source_fingerprint": source["fingerprint"],
        "source_version": source["source_version"],
        "citation_version": context["citation_version"],
        "render_version": RENDER_VERSION,
        "source": source,
        "context": context,
        "renders": renders,
    }
    return build_api_citation_record(
        {
            "id": instance_row.get("id"),
            "source_id": instance_row.get("source_id"),
            "context": context,
            "created_at": instance_row.get("created_at"),
            "style": preferred_style or "mla",
        },
        source,
        render_bundle,
        preferred_style=preferred_style,
    )


def _record_from_legacy_row(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    normalized = normalize_citation_payload(
        legacy_metadata_to_payload(
            url=row.get("url") or metadata.get("url") or "",
            excerpt=row.get("excerpt") or "",
            metadata=metadata,
            full_text=row.get("full_text"),
        ),
    )
    source = normalized["source"]
    context = normalized["context"]
    return build_api_citation_record(
        {
            "id": row.get("id"),
            "source_id": row.get("source_fingerprint") or source.get("fingerprint"),
            "context": context,
            "created_at": row.get("cited_at"),
            "style": row.get("format") or "mla",
        },
        source,
        preferred_style=row.get("format") or "mla",
    )


async def list_citation_records(
    user_id: str,
    *,
    ids: list[str] | None = None,
    limit: int = 50,
    search: str | None = None,
    format: str | None = None,
) -> list[dict[str, Any]]:
    requested_ids = list(ids or [])
    params = {
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": str(limit),
        "select": "id,source_id,locator,quote_text,excerpt,annotation,citation_version,created_at",
    }
    if ids:
        params["id"] = f"in.({','.join(_quote_id_for_supabase(raw_id) for raw_id in ids)})"

    response = await supabase_repo.get(
        "citation_instances",
        params=params,
        headers=supabase_repo.headers(include_content_type=False),
    )

    if response.status_code == 200:
        rows = response.json() or []
        source_map = await _fetch_sources_by_ids([row["source_id"] for row in rows if row.get("source_id")])
        render_map = await _fetch_renders([row["id"] for row in rows if row.get("id")])
        records = []
        for row in rows:
            source_row = source_map.get(row.get("source_id"))
            if not source_row:
                continue
            preferred_style = (format or "mla").strip().lower() if format else "mla"
            records.append(_record_from_new_rows(row, source_row, render_map.get(row["id"], {}), preferred_style=preferred_style))
        if search and search.strip():
            needle = search.strip().lower()
            records = [
                record
                for record in records
                if needle in (record.get("excerpt") or "").lower()
                or needle in (record.get("full_citation") or "").lower()
                or needle in (record.get("url") or "").lower()
                or needle in ((record.get("source") or {}).get("title") or "").lower()
            ]
        if format:
            normalized_format = format.strip().lower()
            records = [record for record in records if record.get("format") == normalized_format]
        if requested_ids:
            records_by_id = {record.get("id"): record for record in records}
            records = [records_by_id[citation_id] for citation_id in requested_ids if citation_id in records_by_id]
        return records

    if not _is_schema_missing_response(response):
        raise HTTPException(status_code=500, detail="Failed to load citations")

    legacy_params = {
        "user_id": f"eq.{user_id}",
        "order": "cited_at.desc",
        "limit": str(limit),
        "select": "id,url,excerpt,inline_citation,full_citation,full_text,cited_at,format,metadata",
    }
    if ids:
        legacy_params["id"] = f"in.({','.join(_quote_id_for_supabase(raw_id) for raw_id in ids)})"
    legacy_response = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citations",
        params=legacy_params,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    if legacy_response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load citations")
    records = [_record_from_legacy_row(row) for row in (legacy_response.json() or [])]
    if search and search.strip():
        needle = search.strip().lower()
        records = [
            record
            for record in records
            if needle in (record.get("excerpt") or "").lower()
            or needle in (record.get("full_citation") or "").lower()
            or needle in (record.get("url") or "").lower()
        ]
    if format:
        normalized_format = format.strip().lower()
        records = [record for record in records if record.get("format") == normalized_format]
    if requested_ids:
        records_by_id = {record.get("id"): record for record in records}
        records = [records_by_id[citation_id] for citation_id in requested_ids if citation_id in records_by_id]
    return records


async def create_citation(
    user_id: str,
    account_type: str,
    citation: CitationInput,
) -> str:
    citation_format = (citation.format or "mla").strip().lower()
    normalized_account_type = normalize_account_type(account_type)
    allowed_formats = allowed_citation_formats(normalized_account_type)

    if citation_format not in allowed_formats:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CITATION_FORMAT_LOCKED",
                "message": "Citation format not available on your plan.",
                "toast": "Upgrade to unlock this citation format.",
            },
        )

    if citation_format == "custom":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CITATION_FORMAT_DEPRECATED",
                "message": "Custom citation templates are deprecated in the metadata-first citation architecture.",
            },
        )

    extraction_payload = _build_extraction_payload(citation)
    normalized = normalize_citation_payload(extraction_payload)
    source_row = await _upsert_source(normalized["source"])
    if source_row is None:
        return await _legacy_create_citation_row(user_id, citation, normalized)

    citation_instance_row = await _create_citation_instance_row(user_id=user_id, source_row=source_row, normalized=normalized)
    if citation_instance_row is None:
        return await _legacy_create_citation_row(user_id, citation, normalized)

    render_bundle = generate_render_bundle(normalized["source"], normalized["context"])
    await _store_render_cache(citation_instance_row["id"], source_row["id"], render_bundle)
    return citation_instance_row["id"]


@router.get("/api/citation-templates")
async def list_citation_templates(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    try:
        response = await record_dependency_call_async(
            "supabase",
            lambda: http_client.get(
                f"{SUPABASE_URL}/rest/v1/citation_templates",
                params={"user_id": f"eq.{user_id}", "select": "id,name,template,created_at,updated_at", "order": "updated_at.desc"},
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("citation_templates.fetch_exception user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail={"code": "CITATION_TEMPLATES_DEPENDENCY_ERROR", "message": "Citation templates are temporarily unavailable."},
        ) from exc

    if response.status_code != 200:
        _upstream_failure(
            request=request,
            route_name="citation_templates.list",
            status_code=response.status_code,
            body_snippet=(response.text or "")[:220],
            code="CITATION_TEMPLATES_FETCH_FAILED",
            message="Citation templates are temporarily unavailable.",
        )
    return response.json() or []


@router.post("/api/citation-templates")
async def create_citation_template(request: Request, payload: CitationTemplateInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    ok, error = validate_template(payload.template)
    if not ok:
        raise HTTPException(status_code=422, detail=error)

    now_iso = datetime.utcnow().isoformat()
    response = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"user_id": user_id, "name": payload.name.strip()[:80], "template": payload.template, "created_at": now_iso, "updated_at": now_iso},
    )
    if response.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create citation template")
    return response.json()[0]


@router.put("/api/citation-templates/{template_id}")
async def update_citation_template(request: Request, template_id: str, payload: CitationTemplateInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    ok, error = validate_template(payload.template)
    if not ok:
        raise HTTPException(status_code=422, detail=error)

    response = await http_client.patch(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"name": payload.name.strip()[:80], "template": payload.template, "updated_at": datetime.utcnow().isoformat()},
    )
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to update citation template")
    rows = response.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return rows[0]


@router.delete("/api/citation-templates/{template_id}")
async def delete_citation_template(request: Request, template_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    response = await http_client.delete(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Prefer": "return=representation"},
    )
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to delete citation template")
    rows = response.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True, "id": template_id}


@router.get("/api/citations")
async def get_user_citations(
    request: Request,
    search: str | None = None,
    limit: int = Query(5, le=100),
    format: str | None = None,
):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return await list_citation_records(user_id, limit=limit, search=search, format=format)


@router.get("/api/citations/by_ids")
async def get_citations_by_ids(request: Request, ids: str = Query("")):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    raw_ids = [item.strip() for item in ids.split(",") if item.strip()]
    if not raw_ids:
        return []
    if len(raw_ids) > 100:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CITATION_IDS_TOO_MANY",
                "message": "Too many citation ids requested.",
            },
        )

    try:
        return await list_citation_records(user_id, ids=raw_ids, limit=len(raw_ids))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("citations.by_ids_exception user_id=%s id_count=%s", user_id, len(raw_ids))
        raise HTTPException(
            status_code=503,
            detail={"code": "CITATIONS_DEPENDENCY_ERROR", "message": "Citations are temporarily unavailable."},
        ) from exc


@router.post("/api/citations")
async def add_citation(request: Request, citation: CitationInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = normalize_account_type(request.state.account_type)
    citation_id = await create_citation(user_id, account_type, citation)
    records = await list_citation_records(user_id, ids=[citation_id], limit=1, format=citation.format)
    if records:
        record = records[0]
    else:
        normalized = normalize_citation_payload(_build_extraction_payload(citation))
        render_bundle = generate_render_bundle(normalized["source"], normalized["context"], styles=[(citation.format or "mla").lower()])
        record = build_api_citation_record(
            {
                "id": citation_id,
                "source_id": normalized["source"]["fingerprint"],
                "context": normalized["context"],
                "created_at": datetime.utcnow().isoformat(),
                "style": citation.format or "mla",
            },
            normalized["source"],
            render_bundle,
            preferred_style=citation.format or "mla",
        )

    return {
        "status": "success",
        "citation_id": citation_id,
        **record,
    }


@router.post("/api/citations/render")
async def render_citation_payload(request: Request, citation: CitationInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    style = (citation.format or "mla").strip().lower()
    if style not in SUPPORTED_STYLES:
        raise HTTPException(status_code=422, detail={"code": "CITATION_STYLE_UNSUPPORTED", "message": "Unsupported citation style."})

    normalized = normalize_citation_payload(_build_extraction_payload(citation))
    render_bundle = generate_render_bundle(normalized["source"], normalized["context"], styles=[style])
    outputs = render_bundle["renders"][style]
    return {
        "style": style,
        "source_fingerprint": normalized["source"]["fingerprint"],
        "source_version": normalized["source"]["source_version"],
        "citation_version": normalized["context"]["citation_version"],
        "render_version": RENDER_VERSION,
        "metadata": {
            **(normalized["source"].get("metadata") or {}),
            "title": normalized["source"]["title"],
            "authors": normalized["source"]["authors"],
            "author": normalized["source"]["author"],
            "siteName": normalized["source"]["site_name"],
            "publisher": normalized["source"]["publisher"],
            "datePublished": normalized["source"]["issued"]["raw"],
            "url": normalized["source"]["canonical_url"] or normalized["source"]["page_url"],
            "locator": normalized["context"]["locator"],
        },
        "source": normalized["source"],
        "context": normalized["context"],
        "inline_citation": outputs["inline"],
        "full_citation": outputs["bibliography"],
        "footnote": outputs["footnote"],
        "quote_attribution": outputs["quote_attribution"],
    }


@router.delete("/api/citations/{citation_id}")
async def delete_citation(request: Request, citation_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    response = await supabase_repo.delete(
        "citation_instances",
        params={"id": f"eq.{citation_id}", "user_id": f"eq.{user_id}"},
        headers=supabase_repo.headers(prefer="return=representation", include_content_type=False),
    )
    if response.status_code == 200:
        rows = response.json() or []
        if rows:
            return {"ok": True, "id": citation_id}
        raise HTTPException(status_code=404, detail="Citation not found")
    if not _is_schema_missing_response(response):
        raise HTTPException(status_code=500, detail="Failed to delete citation")

    legacy_response = await http_client.delete(
        f"{SUPABASE_URL}/rest/v1/citations",
        params={"id": f"eq.{citation_id}", "user_id": f"eq.{user_id}"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Prefer": "return=representation"},
    )
    if legacy_response.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to delete citation")
    rows = legacy_response.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Citation not found")
    return {"ok": True, "id": citation_id}
