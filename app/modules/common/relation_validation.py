from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.modules.research.common import normalize_uuid, normalize_uuid_list
from app.services.supabase_rest import response_error_text, response_json


def _dedupe_sources(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str | None, str | None]] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        source_id = str(item.get("source_id") or "").strip() or None
        citation_id = str(item.get("citation_id") or "").strip() or None
        if source_id:
            source_id = normalize_uuid(source_id, field_name="source_id")
        if citation_id:
            citation_id = normalize_uuid(citation_id, field_name="citation_id")
        if not url and not source_id and not citation_id:
            continue
        key = (url.lower(), source_id, citation_id)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "id": item.get("id"),
                "source_id": source_id,
                "citation_id": citation_id,
                "relation_type": (item.get("relation_type") or "external"),
                "url": url or None,
                "hostname": (item.get("hostname") or "").strip() or None,
                "title": (item.get("title") or "").strip() or None,
                "source_author": (item.get("source_author") or "").strip() or None,
                "source_published_at": (item.get("source_published_at") or "").strip() or None,
                "display": {
                    "label": (item.get("title") or item.get("url") or "").strip() or None,
                    "subtitle": (item.get("hostname") or "").strip() or None,
                },
                "position": index,
            }
        )
    return normalized


class RelationValidator:
    def __init__(self, *, taxonomy_service, citations_service, notes_repository):
        self.taxonomy_service = taxonomy_service
        self.citations_service = citations_service
        self.notes_repository = notes_repository

    def normalize_relation_ids(self, raw_ids: list[str], *, field_name: str) -> list[str]:
        return normalize_uuid_list(raw_ids, field_name=field_name)

    async def validate_owned_tag_ids(self, *, user_id: str, access_token: str | None, tag_ids: list[str]) -> list[str]:
        try:
            return await self.taxonomy_service.resolve_tag_ids(
                user_id=user_id,
                access_token=access_token,
                tag_ids=self.normalize_relation_ids(tag_ids, field_name="tag_id"),
                names=[],
            )
        except HTTPException as exc:
            raise HTTPException(status_code=422, detail="Invalid tag references") from exc

    async def validate_owned_citation_ids(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> list[str]:
        normalized = self.normalize_relation_ids(citation_ids, field_name="citation_id")
        if not normalized:
            return []
        rows = await self.citations_service.list_citations(
            user_id=user_id,
            access_token=access_token,
            ids=normalized,
            limit=len(normalized),
        )
        found_ids = {row.get("id") for row in rows if row.get("id")}
        if any(citation_id not in found_ids for citation_id in normalized):
            raise HTTPException(status_code=422, detail="Invalid citation references")
        return normalized

    async def validate_owned_note_ids(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[str]:
        normalized = self.normalize_relation_ids(note_ids, field_name="note_id")
        if not normalized:
            return []
        rows = await self.notes_repository.list_notes_by_ids(user_id=user_id, access_token=access_token, note_ids=normalized)
        found_ids = {row.get("id") for row in rows if row.get("id")}
        if any(note_id not in found_ids for note_id in normalized):
            raise HTTPException(status_code=422, detail="Invalid note references")
        return normalized

    def validate_linked_note_ids(self, *, note_id: str, linked_note_ids: list[str]) -> list[str]:
        normalized_note_id = normalize_uuid(note_id, field_name="note_id")
        normalized_linked_ids = self.normalize_relation_ids(linked_note_ids, field_name="linked_note_id")
        if normalized_note_id in normalized_linked_ids:
            raise HTTPException(status_code=422, detail="A note cannot link to itself")
        return normalized_linked_ids

    def normalize_note_sources(self, *, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _dedupe_sources(sources)


def map_relation_error(response, *, missing_parent_detail: str, invalid_related_detail: str) -> HTTPException:
    detail = response_error_text(response).lower()
    if "not_found_or_not_owned" in detail or "document_not_found" in detail or "note_not_found" in detail:
        return HTTPException(status_code=404, detail=missing_parent_detail)
    return HTTPException(status_code=422, detail=invalid_related_detail)


def extract_rpc_payload(response, *, result_key: str) -> Any:
    payload = response_json(response)
    if isinstance(payload, dict):
        return payload.get(result_key, payload)
    if isinstance(payload, list) and len(payload) == 1 and isinstance(payload[0], dict):
        return payload[0].get(result_key, payload[0])
    return payload
