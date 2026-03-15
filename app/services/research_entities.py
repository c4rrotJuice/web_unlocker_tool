from __future__ import annotations

from datetime import datetime
import os
from uuid import UUID, uuid4

from fastapi import HTTPException

from app.services.supabase_rest import (
    SupabaseRestRepository,
    response_error_code,
    response_error_text,
    response_json,
)


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_repo = SupabaseRestRepository(base_url=SUPABASE_URL, service_role_key=SUPABASE_KEY)


def is_schema_missing_response(response) -> bool:
    if response.status_code not in (400, 404):
        return False
    detail = response_error_text(response).lower()
    return any(token in detail for token in ("column", "relation", "table", "schema cache", "function"))


def _normalize_uuid_list(raw_ids: list[str], *, field_name: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in raw_ids:
        item_id = normalize_uuid(raw_id, field_name=field_name)
        if item_id in seen:
            continue
        seen.add(item_id)
        normalized.append(item_id)
    return normalized


def _extract_rpc_result(response, *, key: str):
    body = response_json(response)
    if isinstance(body, dict):
        return body.get(key, body)
    if isinstance(body, list) and len(body) == 1 and isinstance(body[0], dict) and key in body[0]:
        return body[0][key]
    return body


def _raise_rpc_write_error(
    response,
    *,
    detail: str,
    missing_schema_detail: str,
    missing_parent_detail: str | None = None,
) -> None:
    if is_schema_missing_response(response):
        raise HTTPException(status_code=503, detail=missing_schema_detail)
    error_code = response_error_code(response)
    error_detail = response_error_text(response).lower()
    if missing_parent_detail and error_code == "P0001" and "parent_not_found" in error_detail:
        raise HTTPException(status_code=404, detail=missing_parent_detail)
    raise HTTPException(status_code=500, detail=detail)


async def _call_atomic_replace_rpc(
    function_name: str,
    payload: dict,
    *,
    detail: str,
    missing_schema_detail: str,
    missing_parent_detail: str | None = None,
    result_key: str,
):
    response = await supabase_repo.rpc(function_name, json=payload, headers=supabase_repo.headers())
    if response.status_code != 200:
        _raise_rpc_write_error(
            response,
            detail=detail,
            missing_schema_detail=missing_schema_detail,
            missing_parent_detail=missing_parent_detail,
        )
    return _extract_rpc_result(response, key=result_key)


def normalize_uuid(raw_id: str | None, *, field_name: str) -> str:
    candidate = (raw_id or "").strip()
    if not candidate:
        raise HTTPException(status_code=422, detail=f"{field_name} is required")
    try:
        return str(UUID(candidate))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} must be a valid UUID") from exc


async def ensure_project_exists(user_id: str, project_id: str | None) -> str | None:
    if not project_id:
        return None
    normalized = normalize_uuid(project_id, field_name="project_id")
    res = await supabase_repo.get(
        "projects",
        params={"id": f"eq.{normalized}", "user_id": f"eq.{user_id}", "select": "id", "limit": 1},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to validate project")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")
    return normalized


async def list_projects(user_id: str, *, limit: int = 200) -> list[dict]:
    res = await supabase_repo.get(
        "projects",
        params={
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": str(limit),
            "select": "id,name,color,description,status,icon,last_opened_at,archived_at,created_at,updated_at",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load projects")
    return res.json() or []


async def create_project(user_id: str, *, name: str, color: str | None = None, description: str | None = None) -> dict:
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=422, detail="name is required")

    existing = await supabase_repo.get(
        "projects",
        params={"user_id": f"eq.{user_id}", "name": f"ilike.{clean_name}", "select": "id,name,color,description,status,icon,last_opened_at,archived_at,created_at,updated_at", "limit": 1},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if existing.status_code == 200 and (existing.json() or []):
        return existing.json()[0]

    res = await supabase_repo.post(
        "projects",
        json={
            "user_id": user_id,
            "name": clean_name[:120],
            "color": (color or "").strip() or None,
            "description": (description or "").strip() or None,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        },
        headers=supabase_repo.headers(prefer="return=representation"),
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create project")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create project")
    return rows[0]


async def delete_project(user_id: str, project_id: str) -> None:
    normalized = normalize_uuid(project_id, field_name="project_id")
    res = await supabase_repo.delete(
        "projects",
        params={"id": f"eq.{normalized}", "user_id": f"eq.{user_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to delete project")


async def list_tags(user_id: str, *, limit: int = 200) -> list[dict]:
    res = await supabase_repo.get(
        "tags",
        params={"user_id": f"eq.{user_id}", "order": "updated_at.desc", "limit": str(limit), "select": "id,name,created_at,updated_at"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load tags")
    return res.json() or []


async def _validate_owned_tag_ids(user_id: str, tag_ids: list[str]) -> list[str]:
    normalized = _normalize_uuid_list(tag_ids, field_name="tag_id")

    if not normalized:
        return []

    res = await supabase_repo.get(
        "tags",
        params={
            "user_id": f"eq.{user_id}",
            "id": f"in.({','.join(normalized)})",
            "select": "id",
            "limit": str(len(normalized)),
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to validate tags")

    found_ids = {row.get("id") for row in (res.json() or []) if row.get("id")}
    if len(found_ids) != len(normalized):
        raise HTTPException(status_code=403, detail="Invalid tag references.")
    return normalized


async def ensure_tags(user_id: str, *, tag_ids: list[str] | None = None, tag_names: list[str] | None = None) -> list[str]:
    resolved = await _validate_owned_tag_ids(user_id, tag_ids or [])
    seen = set(resolved)

    for name in tag_names or []:
        clean_name = (name or "").strip()
        if not clean_name:
            continue
        existing = await supabase_repo.get(
            "tags",
            params={"user_id": f"eq.{user_id}", "name": f"ilike.{clean_name}", "select": "id,name", "limit": 1},
            headers=supabase_repo.headers(include_content_type=False),
        )
        if existing.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to load tags")
        rows = existing.json() or []
        if rows:
            tag_id = rows[0]["id"]
        else:
            created = await supabase_repo.post(
                "tags",
                json={"user_id": user_id, "name": clean_name[:80], "created_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()},
                headers=supabase_repo.headers(prefer="return=representation"),
            )
            if created.status_code not in (200, 201):
                raise HTTPException(status_code=500, detail="Failed to create tag")
            created_rows = created.json() or []
            if not created_rows:
                raise HTTPException(status_code=500, detail="Failed to create tag")
            tag_id = created_rows[0]["id"]
        if tag_id not in seen:
            seen.add(tag_id)
            resolved.append(tag_id)
    return resolved


async def replace_note_tag_links(user_id: str, note_id: str, tag_ids: list[str]) -> None:
    normalized_note_id = normalize_uuid(note_id, field_name="note_id")
    normalized = await _validate_owned_tag_ids(user_id, tag_ids)
    await _call_atomic_replace_rpc(
        "replace_note_tag_links_atomic",
        {"p_user_id": user_id, "p_note_id": normalized_note_id, "p_tag_ids": normalized},
        detail="Failed to update note tags",
        missing_schema_detail="Note tags are not configured in the database yet",
        missing_parent_detail="Note not found",
        result_key="replace_note_tag_links_atomic",
    )


async def replace_document_tags(user_id: str, document_id: str, tag_ids: list[str]) -> None:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    normalized = await _validate_owned_tag_ids(user_id, tag_ids)
    await _call_atomic_replace_rpc(
        "replace_document_tags_atomic",
        {"p_user_id": user_id, "p_document_id": normalized_document_id, "p_tag_ids": normalized},
        detail="Failed to update document tags",
        missing_schema_detail="Document tags are not configured in the database yet",
        missing_parent_detail="Document not found",
        result_key="replace_document_tags_atomic",
    )


async def add_document_tags(user_id: str, document_id: str, tag_ids: list[str]) -> None:
    normalized = await _validate_owned_tag_ids(user_id, tag_ids)
    if not normalized:
        return
    rows = [{"document_id": document_id, "tag_id": tag_id, "user_id": user_id} for tag_id in normalized]
    insert_res = await supabase_repo.post(
        "document_tags",
        json=rows,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
    )
    if is_schema_missing_response(insert_res):
        raise HTTPException(status_code=503, detail="Document tags are not configured in the database yet")
    if insert_res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to update document tags")


async def remove_document_tag(user_id: str, document_id: str, tag_id: str) -> None:
    normalized = normalize_uuid(tag_id, field_name="tag_id")
    validated_ids = await _validate_owned_tag_ids(user_id, [normalized])
    res = await supabase_repo.delete(
        "document_tags",
        params={"user_id": f"eq.{user_id}", "document_id": f"eq.{document_id}", "tag_id": f"eq.{validated_ids[0]}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Document tags are not configured in the database yet")
    if res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=500, detail="Failed to update document tags")


async def replace_document_citations(user_id: str, document_id: str, citation_ids: list[str]) -> list[str]:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    normalized = _normalize_uuid_list(citation_ids, field_name="citation_id")
    result = await _call_atomic_replace_rpc(
        "replace_document_citations_atomic",
        {"p_user_id": user_id, "p_document_id": normalized_document_id, "p_citation_ids": normalized},
        detail="Failed to update document citations",
        missing_schema_detail="Document citations are not configured in the database yet",
        missing_parent_detail="Document not found",
        result_key="replace_document_citations_atomic",
    )
    return result if isinstance(result, list) else normalized


async def _validate_owned_citation_ids(user_id: str, citation_ids: list[str]) -> list[str]:
    normalized = _normalize_uuid_list(citation_ids, field_name="citation_id")
    if not normalized:
        return []

    res = await supabase_repo.get(
        "citation_instances",
        params={
            "id": f"in.({','.join(normalized)})",
            "select": "id,user_id",
            "limit": str(len(normalized)),
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Canonical citations are not configured in the database yet")
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to validate citations")

    rows = res.json() or []
    by_id = {row.get("id"): row for row in rows if row.get("id")}
    missing_ids = [citation_id for citation_id in normalized if citation_id not in by_id]
    if missing_ids:
        raise HTTPException(status_code=404, detail="Citation not found")

    foreign_ids = [citation_id for citation_id in normalized if by_id[citation_id].get("user_id") != user_id]
    if foreign_ids:
        raise HTTPException(status_code=403, detail="Invalid citation references.")

    return normalized


async def validate_owned_citation_ids(user_id: str, citation_ids: list[str]) -> list[str]:
    return await _validate_owned_citation_ids(user_id, citation_ids)


async def list_document_citation_links(user_id: str, document_id: str) -> list[dict]:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    res = await supabase_repo.get(
        "document_citations",
        params={
            "user_id": f"eq.{user_id}",
            "document_id": f"eq.{normalized_document_id}",
            "select": "document_id,citation_id,attached_at",
            "order": "attached_at.asc,citation_id.asc",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Document citations are not configured in the database yet")
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load document citations")

    rows = res.json() or []
    ordered_ids = [row.get("citation_id") for row in rows if row.get("citation_id")]
    if not ordered_ids:
        return []

    from app.routes.citations import list_citation_records

    records = await list_citation_records(user_id, ids=ordered_ids, limit=len(ordered_ids))
    by_id = {record.get("id"): record for record in records if record.get("id")}

    hydrated: list[dict] = []
    for row in rows:
        citation_id = row.get("citation_id")
        citation = by_id.get(citation_id)
        if not citation:
            continue
        hydrated.append(
            {
                "doc_id": row.get("document_id"),
                "citation_id": citation_id,
                "attached_at": row.get("attached_at"),
                "citation": citation,
            }
        )
    return hydrated


async def add_document_citations(user_id: str, document_id: str, citation_ids: list[str]) -> list[str]:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    normalized = await _validate_owned_citation_ids(user_id, citation_ids)
    if not normalized:
        return await list_document_citation_ids(user_id, normalized_document_id)

    current_ids = await list_document_citation_ids(user_id, normalized_document_id)
    existing = set(current_ids)
    final_ids = list(current_ids)
    for citation_id in normalized:
        if citation_id in existing:
            continue
        existing.add(citation_id)
        final_ids.append(citation_id)
    return await replace_document_citations(user_id, normalized_document_id, final_ids)


async def remove_document_citation(user_id: str, document_id: str, citation_id: str) -> None:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    normalized_citation_id = normalize_uuid(citation_id, field_name="citation_id")
    await _validate_owned_citation_ids(user_id, [normalized_citation_id])
    current_ids = await list_document_citation_ids(user_id, normalized_document_id)
    if normalized_citation_id not in current_ids:
        return
    final_ids = [current_id for current_id in current_ids if current_id != normalized_citation_id]
    await replace_document_citations(user_id, normalized_document_id, final_ids)


def _normalize_note_sources_payload(sources: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    seen: set[str] = set()
    for src in sources:
        if not isinstance(src, dict):
            continue
        url = str(src.get("url") or "").strip()
        if not url:
            continue
        dedupe_key = url.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized.append(
            {
                "url": url,
                "title": (src.get("title") or "").strip() or None,
                "hostname": (src.get("hostname") or "").strip() or None,
                "source_author": (src.get("source_author") or "").strip() or None,
                "source_published_at": (src.get("source_published_at") or "").strip() or None,
                "attached_at": (src.get("attached_at") or "").strip() or None,
            }
        )
    return normalized


async def replace_note_sources(user_id: str, note_id: str, sources: list[dict]) -> list[dict]:
    normalized_note_id = normalize_uuid(note_id, field_name="note_id")
    normalized_sources = _normalize_note_sources_payload(sources)
    result = await _call_atomic_replace_rpc(
        "replace_note_sources_atomic",
        {"p_user_id": user_id, "p_note_id": normalized_note_id, "p_sources": normalized_sources},
        detail="Failed to update note sources",
        missing_schema_detail="Note sources are not configured in the database yet",
        missing_parent_detail="Note not found",
        result_key="replace_note_sources_atomic",
    )
    return result if isinstance(result, list) else normalized_sources


async def replace_note_links(user_id: str, note_id: str, linked_note_ids: list[str]) -> list[str]:
    normalized_note_id = normalize_uuid(note_id, field_name="note_id")
    normalized_linked_ids = _normalize_uuid_list(linked_note_ids, field_name="linked_note_id")
    result = await _call_atomic_replace_rpc(
        "replace_note_links_atomic",
        {"p_user_id": user_id, "p_note_id": normalized_note_id, "p_linked_note_ids": normalized_linked_ids},
        detail="Failed to update linked notes",
        missing_schema_detail="Note links are not configured in the database yet",
        missing_parent_detail="Note not found",
        result_key="replace_note_links_atomic",
    )
    return result if isinstance(result, list) else normalized_linked_ids


async def list_document_citation_ids(user_id: str, document_id: str) -> list[str]:
    res = await supabase_repo.get(
        "document_citations",
        params={"user_id": f"eq.{user_id}", "document_id": f"eq.{document_id}", "select": "citation_id", "order": "attached_at.asc,citation_id.asc"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Document citations are not configured in the database yet")
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load document citations")
    return [row.get("citation_id") for row in (res.json() or []) if row.get("citation_id")]


async def list_document_citation_ids_map(user_id: str, document_ids: list[str]) -> dict[str, list[str]]:
    normalized = [normalize_uuid(raw_id, field_name="document_id") for raw_id in document_ids if raw_id]
    if not normalized:
        return {}
    res = await supabase_repo.get(
        "document_citations",
        params={
            "user_id": f"eq.{user_id}",
            "document_id": f"in.({','.join(normalized)})",
            "select": "document_id,citation_id,attached_at",
            "order": "attached_at.asc,citation_id.asc",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Document citations are not configured in the database yet")
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load document citations")
    by_document: dict[str, list[str]] = {doc_id: [] for doc_id in normalized}
    for row in res.json() or []:
        document_id = row.get("document_id")
        citation_id = row.get("citation_id")
        if not document_id or not citation_id:
            continue
        by_document.setdefault(document_id, []).append(citation_id)
    return by_document


async def list_document_tag_ids(user_id: str, document_id: str) -> list[str]:
    tag_map = await list_document_tag_maps(user_id, [document_id])
    return tag_map.get(document_id, {}).get("tag_ids", [])


async def list_document_tags(user_id: str, document_id: str) -> list[dict]:
    tag_map = await list_document_tag_maps(user_id, [document_id])
    return tag_map.get(document_id, {}).get("tags", [])


async def list_document_tag_maps(user_id: str, document_ids: list[str]) -> dict[str, dict]:
    normalized = [normalize_uuid(raw_id, field_name="document_id") for raw_id in document_ids if raw_id]
    if not normalized:
        return {}
    res = await supabase_repo.get(
        "document_tags",
        params={
            "user_id": f"eq.{user_id}",
            "document_id": f"in.({','.join(normalized)})",
            "select": "document_id,tag_id,created_at,tags(id,name,created_at,updated_at)",
            "order": "created_at.asc",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(res):
        raise HTTPException(status_code=503, detail="Document tags are not configured in the database yet")
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load document tags")
    by_document: dict[str, dict] = {doc_id: {"tag_ids": [], "tags": []} for doc_id in normalized}
    for row in res.json() or []:
        document_id = row.get("document_id")
        tag_id = row.get("tag_id")
        if not document_id or not tag_id:
            continue
        entry = by_document.setdefault(document_id, {"tag_ids": [], "tags": []})
        entry["tag_ids"].append(tag_id)
        tag_row = row.get("tags")
        if isinstance(tag_row, list):
            tag_row = tag_row[0] if tag_row else None
        if isinstance(tag_row, dict) and tag_row.get("id"):
            entry["tags"].append(
                {
                    "id": tag_row.get("id"),
                    "name": tag_row.get("name"),
                    "created_at": tag_row.get("created_at"),
                    "updated_at": tag_row.get("updated_at"),
                }
            )
    return by_document


async def list_note_tag_ids(user_id: str, note_ids: list[str]) -> dict[str, list[str]]:
    if not note_ids:
        return {}
    res = await supabase_repo.get(
        "note_tag_links",
        params={"user_id": f"eq.{user_id}", "note_id": f"in.({','.join(note_ids)})", "select": "note_id,tag_id"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        return {}
    by_note: dict[str, list[str]] = {}
    for row in res.json() or []:
        note_id = row.get("note_id")
        tag_id = row.get("tag_id")
        if not note_id or not tag_id:
            continue
        by_note.setdefault(note_id, []).append(tag_id)
    return by_note


def _quote_select_fields() -> str:
    return "id,citation_id,user_id,excerpt,locator,annotation,created_at,updated_at"


def _paginate_rows(rows: list[dict], *, limit: int, offset: int) -> list[dict]:
    normalized_offset = max(offset, 0)
    normalized_limit = min(max(limit, 1), 500)
    return rows[normalized_offset:normalized_offset + normalized_limit]


async def _list_note_ids_by_quote(user_id: str, quote_ids: list[str]) -> dict[str, list[str]]:
    if not quote_ids:
        return {}
    res = await supabase_repo.get(
        "notes",
        params={
            "user_id": f"eq.{user_id}",
            "quote_id": f"in.({','.join(quote_ids)})",
            "select": "id,quote_id",
            "order": "created_at.asc,id.asc",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load linked notes")
    by_quote: dict[str, list[str]] = {}
    for row in res.json() or []:
        quote_id = row.get("quote_id")
        note_id = row.get("id")
        if not quote_id or not note_id:
            continue
        by_quote.setdefault(quote_id, []).append(note_id)
    return by_quote


async def _hydrate_quote_rows(user_id: str, rows: list[dict]) -> list[dict]:
    if not rows:
        return []

    from app.routes.citations import list_citation_records

    citation_ids = _normalize_uuid_list([row["citation_id"] for row in rows if row.get("citation_id")], field_name="citation_id")
    note_ids_by_quote = await _list_note_ids_by_quote(user_id, [row["id"] for row in rows if row.get("id")])
    citations = await list_citation_records(user_id, ids=citation_ids, limit=len(citation_ids))
    citations_by_id = {citation.get("id"): citation for citation in citations if citation.get("id")}

    hydrated: list[dict] = []
    for row in rows:
        note_ids = note_ids_by_quote.get(row.get("id"), [])
        hydrated.append(
            {
                "id": row.get("id"),
                "citation_id": row.get("citation_id"),
                "excerpt": row.get("excerpt") or "",
                "locator": row.get("locator") or {},
                "annotation": row.get("annotation"),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "citation": citations_by_id.get(row.get("citation_id")),
                "note_ids": note_ids,
                "note_count": len(note_ids),
                "workflow": {
                    "has_notes": bool(note_ids),
                },
            }
        )
    return hydrated


async def _list_quote_rows_for_ids(user_id: str, ids: list[str], *, limit: int, offset: int) -> list[dict]:
    if not ids:
        return []
    params = {
        "user_id": f"eq.{user_id}",
        "id": f"in.({','.join(ids)})",
        "select": _quote_select_fields(),
    }
    res = await supabase_repo.get("quotes", params=params, headers=supabase_repo.headers(include_content_type=False))
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load quotes")
    rows = res.json() or []
    by_id = {row.get("id"): row for row in rows if row.get("id")}
    ordered = [by_id[quote_id] for quote_id in ids if quote_id in by_id]
    return await _hydrate_quote_rows(user_id, _paginate_rows(ordered, limit=limit, offset=offset))


async def _list_quote_rows_default(
    user_id: str,
    *,
    citation_id: str | None,
    limit: int,
    offset: int,
) -> list[dict]:
    params = {
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": str(min(max(limit, 1), 500)),
        "offset": str(max(offset, 0)),
        "select": _quote_select_fields(),
    }
    if citation_id:
        params["citation_id"] = f"eq.{normalize_uuid(citation_id, field_name='citation_id')}"
    res = await supabase_repo.get("quotes", params=params, headers=supabase_repo.headers(include_content_type=False))
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load quotes")
    return await _hydrate_quote_rows(user_id, res.json() or [])


async def _list_quote_rows_for_document(
    user_id: str,
    *,
    document_id: str,
    citation_id: str | None,
    limit: int,
    offset: int,
) -> list[dict]:
    normalized_document_id = normalize_uuid(document_id, field_name="document_id")
    normalized_citation_id = normalize_uuid(citation_id, field_name="citation_id") if citation_id else None
    link_res = await supabase_repo.get(
        "document_citations",
        params={
            "user_id": f"eq.{user_id}",
            "document_id": f"eq.{normalized_document_id}",
            "select": "citation_id,attached_at",
            "order": "attached_at.asc,citation_id.asc",
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if is_schema_missing_response(link_res):
        raise HTTPException(status_code=503, detail="Document citations are not configured in the database yet")
    if link_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load document citations")

    links = link_res.json() or []
    if normalized_citation_id:
        links = [link for link in links if link.get("citation_id") == normalized_citation_id]
    citation_ids_in_order: list[str] = []
    seen: set[str] = set()
    for link in links:
        linked_citation_id = link.get("citation_id")
        if not linked_citation_id or linked_citation_id in seen:
            continue
        seen.add(linked_citation_id)
        citation_ids_in_order.append(linked_citation_id)

    if not citation_ids_in_order:
        return []

    quote_res = await supabase_repo.get(
        "quotes",
        params={
            "user_id": f"eq.{user_id}",
            "citation_id": f"in.({','.join(citation_ids_in_order)})",
            "select": _quote_select_fields(),
        },
        headers=supabase_repo.headers(include_content_type=False),
    )
    if quote_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load quotes")

    grouped: dict[str, list[dict]] = {}
    for row in quote_res.json() or []:
        citation_key = row.get("citation_id")
        if not citation_key:
            continue
        grouped.setdefault(citation_key, []).append(row)

    ordered_rows: list[dict] = []
    for linked_citation_id in citation_ids_in_order:
        ordered_rows.extend(sorted(grouped.get(linked_citation_id, []), key=lambda row: (row.get("created_at") or "", row.get("id") or "")))
    return await _hydrate_quote_rows(user_id, _paginate_rows(ordered_rows, limit=limit, offset=offset))


async def get_quote_row(user_id: str, quote_id: str) -> dict:
    normalized_quote_id = normalize_uuid(quote_id, field_name="quote_id")
    res = await supabase_repo.get(
        "quotes",
        params={"id": f"eq.{normalized_quote_id}", "select": _quote_select_fields(), "limit": "1"},
        headers=supabase_repo.headers(include_content_type=False),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load quote")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Quote not found")
    row = rows[0]
    if row.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Invalid quote reference.")
    return row


async def list_quote_rows(
    user_id: str,
    *,
    citation_id: str | None = None,
    document_id: str | None = None,
    ids: list[str] | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    if ids is not None:
        return await _list_quote_rows_for_ids(user_id, ids, limit=limit, offset=offset)
    if document_id:
        return await _list_quote_rows_for_document(
            user_id,
            document_id=document_id,
            citation_id=citation_id,
            limit=limit,
            offset=offset,
        )
    return await _list_quote_rows_default(user_id, citation_id=citation_id, limit=limit, offset=offset)


async def create_quote_row(user_id: str, *, citation_id: str, excerpt: str, locator: dict | None = None, annotation: str | None = None) -> dict:
    clean_excerpt = (excerpt or "").strip()
    if len(clean_excerpt) < 12:
        raise HTTPException(status_code=422, detail="excerpt must be at least 12 characters")
    normalized_citation_id = (await _validate_owned_citation_ids(user_id, [citation_id]))[0]
    payload = {
        "citation_id": normalized_citation_id,
        "user_id": user_id,
        "excerpt": clean_excerpt,
        "locator": locator or {},
        "annotation": (annotation or "").strip() or None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    res = await supabase_repo.post("quotes", json=payload, headers=supabase_repo.headers(prefer="return=representation"))
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create quote")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create quote")
    hydrated = await _hydrate_quote_rows(user_id, rows[:1])
    if not hydrated:
        raise HTTPException(status_code=500, detail="Failed to hydrate quote")
    return hydrated[0]


def _clean_note_tag_ids(tag_ids: list[str] | None) -> list[str]:
    cleaned: list[str] = []
    for raw_tag_id in tag_ids or []:
        cleaned.append(normalize_uuid(raw_tag_id, field_name="tag_id"))
    return cleaned


def _split_note_tag_inputs(values: list[str] | None) -> tuple[list[str], list[str]]:
    tag_ids: list[str] = []
    tag_names: list[str] = []
    for raw_value in values or []:
        candidate = str(raw_value or "").strip()
        if not candidate:
            continue
        try:
            tag_ids.append(str(UUID(candidate)))
        except ValueError:
            tag_names.append(candidate)
    return tag_ids, tag_names


def _quote_note_body(excerpt: str, annotation: str | None) -> str:
    clean_excerpt = (excerpt or "").strip()
    clean_annotation = (annotation or "").strip()
    if not clean_annotation:
        return clean_excerpt
    return f"{clean_excerpt}\n\nAnnotation: {clean_annotation}"


async def create_note_from_quote(
    user_id: str,
    *,
    quote_id: str,
    title: str | None = None,
    note_body: str | None = None,
    project_id: str | None = None,
    tag_ids: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict:
    quote_row = await get_quote_row(user_id, quote_id)
    resolved_project_id = await ensure_project_exists(user_id, project_id) if project_id else None
    legacy_tag_ids, tag_names = _split_note_tag_inputs(tags)
    resolved_tag_ids = await ensure_tags(
        user_id,
        tag_ids=_clean_note_tag_ids(tag_ids) + legacy_tag_ids,
        tag_names=tag_names,
    )

    note_id = str(uuid4())
    now_iso = datetime.utcnow().isoformat()
    insert_payload = {
        "id": note_id,
        "user_id": user_id,
        "title": (title or "").strip() or None,
        "highlight_text": quote_row.get("excerpt") or "",
        "note_body": (note_body or "").strip() or _quote_note_body(quote_row.get("excerpt") or "", quote_row.get("annotation")),
        "source_url": None,
        "source_title": None,
        "source_author": None,
        "source_published_at": None,
        "source_domain": None,
        "project_id": resolved_project_id,
        "citation_id": quote_row.get("citation_id"),
        "quote_id": quote_row.get("id"),
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    res = await supabase_repo.post(
        "notes",
        json=insert_payload,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=representation"),
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to sync note")

    await replace_note_tag_links(user_id, note_id, resolved_tag_ids)
    return {"ok": True, "note_id": note_id}
