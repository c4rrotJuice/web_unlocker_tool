from __future__ import annotations

from datetime import datetime
import os
from uuid import UUID

from fastapi import HTTPException

from app.services.supabase_rest import SupabaseRestRepository


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_repo = SupabaseRestRepository(base_url=SUPABASE_URL, service_role_key=SUPABASE_KEY)


def response_error_text(response) -> str:
    try:
        body = response.json()
    except Exception:
        return ""
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or "")
    if isinstance(body, list):
        return " ".join(str(item) for item in body)
    return str(body)


def is_schema_missing_response(response) -> bool:
    if response.status_code not in (400, 404):
        return False
    detail = response_error_text(response).lower()
    return any(token in detail for token in ("column", "relation", "table", "schema cache"))


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
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in tag_ids:
        tag_id = normalize_uuid(raw_id, field_name="tag_id")
        if tag_id in seen:
            continue
        seen.add(tag_id)
        normalized.append(tag_id)

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
    normalized = await _validate_owned_tag_ids(user_id, tag_ids)
    delete_res = await supabase_repo.delete(
        "note_tag_links",
        params={"user_id": f"eq.{user_id}", "note_id": f"eq.{note_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if delete_res.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail="Failed to update note tags")
    if not normalized:
        return
    rows = [{"note_id": note_id, "tag_id": tag_id, "user_id": user_id} for tag_id in normalized]
    insert_res = await supabase_repo.post(
        "note_tag_links",
        json=rows,
        headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
    )
    if insert_res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to update note tags")


async def replace_document_tags(user_id: str, document_id: str, tag_ids: list[str]) -> None:
    normalized = await _validate_owned_tag_ids(user_id, tag_ids)
    delete_res = await supabase_repo.delete(
        "document_tags",
        params={"user_id": f"eq.{user_id}", "document_id": f"eq.{document_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if is_schema_missing_response(delete_res):
        raise HTTPException(status_code=503, detail="Document tags are not configured in the database yet")
    if delete_res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=500, detail="Failed to update document tags")
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
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in citation_ids:
        citation_id = normalize_uuid(raw_id, field_name="citation_id")
        if citation_id in seen:
            continue
        seen.add(citation_id)
        normalized.append(citation_id)

    delete_res = await supabase_repo.delete(
        "document_citations",
        params={"user_id": f"eq.{user_id}", "document_id": f"eq.{document_id}"},
        headers=supabase_repo.headers(prefer="return=minimal", include_content_type=False),
    )
    if delete_res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=500, detail="Failed to update document citations")

    if normalized:
        rows = [
            {"document_id": document_id, "citation_id": citation_id, "user_id": user_id, "attached_at": datetime.utcnow().isoformat()}
            for citation_id in normalized
        ]
        insert_res = await supabase_repo.post(
            "document_citations",
            json=rows,
            headers=supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
        )
        if insert_res.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail="Failed to update document citations")
    return normalized


async def list_document_citation_ids(user_id: str, document_id: str) -> list[str]:
    res = await supabase_repo.get(
        "document_citations",
        params={"user_id": f"eq.{user_id}", "document_id": f"eq.{document_id}", "select": "citation_id", "order": "attached_at.asc"},
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
            "order": "attached_at.asc",
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


async def list_quote_rows(user_id: str, *, citation_id: str | None = None, ids: list[str] | None = None) -> list[dict]:
    params = {
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "select": "id,citation_id,excerpt,locator,annotation,created_at,updated_at",
    }
    if citation_id:
        params["citation_id"] = f"eq.{normalize_uuid(citation_id, field_name='citation_id')}"
    if ids:
        params["id"] = f"in.({','.join(normalize_uuid(raw_id, field_name='quote_id') for raw_id in ids)})"
    res = await supabase_repo.get("quotes", params=params, headers=supabase_repo.headers(include_content_type=False))
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load quotes")
    return res.json() or []


async def create_quote_row(user_id: str, *, citation_id: str, excerpt: str, locator: dict | None = None, annotation: str | None = None) -> dict:
    clean_excerpt = (excerpt or "").strip()
    if len(clean_excerpt) < 12:
        raise HTTPException(status_code=422, detail="excerpt must be at least 12 characters")
    payload = {
        "citation_id": normalize_uuid(citation_id, field_name="citation_id"),
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
    return rows[0]
