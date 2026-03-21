from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.core.serialization import serialize_paging_meta
from app.core.serialization import serialize_source_detail, serialize_source_summary
from app.modules.research.sources.repo import SourcesRepository
from app.services.citation_domain import ExtractionPayload, normalize_citation_payload


class SourcesService:
    def __init__(self, *, repository: SourcesRepository):
        self.repository = repository

    def normalize_source(self, payload: ExtractionPayload) -> dict[str, Any]:
        return normalize_citation_payload(payload)["source"]

    async def resolve_or_create_source(
        self,
        *,
        access_token: str | None,
        extraction_payload: ExtractionPayload,
    ) -> dict:
        if not isinstance(extraction_payload, ExtractionPayload):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "EXTRACTION_PAYLOAD_REQUIRED",
                    "message": "Canonical extraction payload is required.",
                },
            )
        normalized_source = self.normalize_source(extraction_payload)
        existing = await self.repository.get_source_by_fingerprint(fingerprint=normalized_source["fingerprint"])
        row = existing
        if row is None:
            row = await self.repository.create_source(
                {
                    "fingerprint": normalized_source["fingerprint"],
                    "source_type": normalized_source["source_type"],
                    "title": normalized_source["title"],
                    "authors": normalized_source["authors"],
                    "container_title": normalized_source["container_title"],
                    "publisher": normalized_source["publisher"],
                    "issued_date": normalized_source["issued"],
                    "identifiers": normalized_source["identifiers"],
                    "canonical_url": normalized_source["canonical_url"],
                    "page_url": normalized_source["page_url"],
                    "hostname": normalized_source["metadata"].get("hostname") or normalized_source.get("hostname"),
                    "language_code": normalized_source["metadata"].get("language"),
                    "metadata": normalized_source["metadata"],
                    "raw_extraction": normalized_source["raw_extraction"],
                    "normalization_version": normalized_source["normalization_version"],
                    "source_version": normalized_source["source_version"],
                }
            )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to resolve source")
        return serialize_source_detail(row, relationship_counts={})

    async def list_sources(
        self,
        *,
        user_id: str,
        access_token: str | None,
        query: str | None = None,
        hostname: str | None = None,
        source_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        rows = await self.repository.list_visible_sources(
            user_id=user_id,
            access_token=access_token,
            source_type=source_type,
            hostname=hostname,
            limit=limit,
            offset=offset,
        )
        if query:
            needle = query.strip().lower()
            rows = [row for row in rows if needle in str(row.get("title") or "").lower() or needle in str(row.get("publisher") or "").lower()]
        counts = await self.repository.count_citations_for_sources(
            user_id=user_id,
            access_token=access_token,
            source_ids=[row["id"] for row in rows if row.get("id")],
        )
        return [serialize_source_summary(row, relationship_counts={"citation_count": counts.get(row["id"], 0)}) for row in rows]

    async def list_sources_page(
        self,
        *,
        user_id: str,
        access_token: str | None,
        query: str | None = None,
        hostname: str | None = None,
        source_type: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> dict[str, object]:
        offset = int(cursor or "0")
        batch_limit = limit + 1
        items = await self.list_sources(
            user_id=user_id,
            access_token=access_token,
            query=query,
            hostname=hostname,
            source_type=source_type,
            limit=batch_limit,
            offset=offset,
        )
        has_more = len(items) > limit
        page_items = items[:limit]
        next_cursor = str(offset + limit) if has_more else None
        return serialize_ok_envelope(page_items, meta=serialize_paging_meta(next_cursor=next_cursor, has_more=has_more))

    async def get_source(self, *, user_id: str, access_token: str | None, source_id: str) -> dict:
        rows = await self.repository.get_sources_by_ids(source_ids=[source_id], access_token=access_token)
        row = rows[0] if rows else None
        if row is None:
            raise HTTPException(status_code=404, detail="Source not found")
        counts = await self.repository.count_citations_for_sources(user_id=user_id, access_token=access_token, source_ids=[source_id])
        return serialize_source_detail(row, relationship_counts={"citation_count": counts.get(source_id, 0)})

    async def get_source_rows_by_ids(self, *, source_ids: list[str], access_token: str | None) -> list[dict]:
        return await self.repository.get_sources_by_ids(source_ids=source_ids, access_token=access_token)

    async def list_sources_by_ids(self, *, user_id: str, access_token: str | None, source_ids: list[str]) -> list[dict]:
        rows = await self.get_source_rows_by_ids(source_ids=source_ids, access_token=access_token)
        counts = await self.repository.count_citations_for_sources(
            user_id=user_id,
            access_token=access_token,
            source_ids=[row["id"] for row in rows if row.get("id")],
        )
        return [
            serialize_source_summary(row, relationship_counts={"citation_count": counts.get(row["id"], 0)})
            for row in rows
            if row.get("id")
        ]
