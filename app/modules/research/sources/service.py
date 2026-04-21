from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.core.serialization import serialize_paging_meta
from app.core.serialization import (
    serialize_citation_reference,
    serialize_document_reference,
    serialize_note_reference,
    serialize_quote_reference,
    serialize_source_detail,
    serialize_source_summary,
)
from app.modules.research.sources.repo import SourcesRepository
from app.services.citation_domain import ExtractionPayload, normalize_citation_payload


logger = logging.getLogger(__name__)


class SourcesService:
    def __init__(self, *, repository: SourcesRepository, citations_repository=None, quotes_repository=None, notes_repository=None, workspace_repository=None, activity_service=None):
        self.repository = repository
        self.citations_repository = citations_repository
        self.quotes_repository = quotes_repository
        self.notes_repository = notes_repository
        self.workspace_repository = workspace_repository
        self.activity_service = activity_service

    async def _list_note_summaries_for_source(self, *, user_id: str, access_token: str | None, source_id: str, citation_ids: list[str]) -> list[dict]:
        if self.notes_repository is None:
            return []
        if hasattr(self.notes_repository, "list_note_summaries_by_source_ids"):
            source_note_rows = await self.notes_repository.list_note_summaries_by_source_ids(
                user_id=user_id,
                access_token=access_token,
                source_ids=[source_id],
            )
        else:
            source_note_rows = []
            seen_note_ids: set[str] = set()
            for note_source_row in await self.notes_repository.list_note_sources_by_source_ids(
                user_id=user_id,
                access_token=access_token,
                source_ids=[source_id],
            ):
                note_id = note_source_row.get("note_id")
                if note_id and note_id not in seen_note_ids:
                    seen_note_ids.add(note_id)
                    rows = await self.notes_repository.list_notes_by_ids(
                        user_id=user_id,
                        access_token=access_token,
                        note_ids=[note_id],
                    )
                    if rows:
                        source_note_rows.append(rows[0])

        if hasattr(self.notes_repository, "list_note_summaries_by_citation_ids"):
            citation_note_rows = await self.notes_repository.list_note_summaries_by_citation_ids(
                user_id=user_id,
                access_token=access_token,
                citation_ids=citation_ids,
            ) if citation_ids else []
        else:
            citation_note_rows = []
            for citation_id in citation_ids:
                citation_note_rows.extend(
                    await self.notes_repository.list_notes(
                        user_id=user_id,
                        access_token=access_token,
                        citation_id=citation_id,
                        limit=20,
                        offset=0,
                    )
                )

        note_rows: list[dict] = []
        seen_note_ids: set[str] = set()
        for row in [*citation_note_rows, *source_note_rows]:
            note_id = row.get("id")
            if note_id and note_id not in seen_note_ids:
                seen_note_ids.add(note_id)
                note_rows.append(row)
        return note_rows

    def normalize_source(self, payload: ExtractionPayload) -> dict[str, Any]:
        return normalize_citation_payload(payload)["source"]

    async def resolve_or_create_source(
        self,
        *,
        user_id: str | None = None,
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
        logger.info(
            "sources.resolve_or_create.start",
            extra={
                "stage": "source_resolve_start",
                "canonical_url": extraction_payload.canonical_url,
                "page_url": extraction_payload.page_url,
                "identifier_keys": sorted(str(key) for key in (extraction_payload.identifiers or {}).keys()),
                "author_candidate_count": len(extraction_payload.author_candidates or []),
                "date_candidate_count": len(extraction_payload.date_candidates or []),
            },
        )
        normalized_source = self.normalize_source(extraction_payload)
        existing = await self.repository.get_source_by_fingerprint(fingerprint=normalized_source["fingerprint"])
        row = existing
        resolution = "reused"
        if row is None:
            resolution = "created"
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
        logger.info(
            "sources.resolve_or_create.success",
            extra={
                "stage": "source_resolve_success",
                "source_id": row.get("id"),
                "fingerprint": normalized_source["fingerprint"],
                "resolution": resolution,
                "source_type": normalized_source["source_type"],
                "author_count": len(normalized_source["authors"] or []),
                "issued_raw": (normalized_source["issued"] or {}).get("raw"),
                "canonical_url": normalized_source["canonical_url"],
            },
        )
        if resolution == "created" and self.activity_service is not None and user_id:
            await self.activity_service.record_event(
                user_id=user_id,
                event_type="source_captured",
                entity_id=str(row.get("id") or ""),
                idempotency_key=f"source-created:{row.get('id')}",
            )
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
        payload = serialize_source_detail(row, relationship_counts={"citation_count": counts.get(source_id, 0)})
        if not all([self.citations_repository, self.quotes_repository, self.notes_repository, self.workspace_repository]):
            return payload
        citation_rows = await self.citations_repository.list_citations(
            user_id=user_id,
            access_token=access_token,
            source_id=source_id,
            limit=20,
            offset=0,
        )
        citation_ids = [item.get("id") for item in citation_rows if item.get("id")]
        quote_rows = await self.quotes_repository.list_quotes(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
            limit=20,
            order="created_at.desc,id.desc",
        ) if citation_ids else []
        note_rows = await self._list_note_summaries_for_source(
            user_id=user_id,
            access_token=access_token,
            source_id=source_id,
            citation_ids=citation_ids,
        )
        document_link_rows = await self.workspace_repository.list_documents_for_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
        ) if citation_ids else []
        document_ids = []
        seen_document_ids: set[str] = set()
        for link in document_link_rows:
            document_id = link.get("document_id")
            if document_id and document_id not in seen_document_ids:
                seen_document_ids.add(document_id)
                document_ids.append(document_id)
        document_rows = await self.workspace_repository.list_documents_by_ids(
            user_id=user_id,
            access_token=access_token,
            document_ids=document_ids,
            summary_only=True,
        ) if document_ids else []
        payload["neighborhood"] = {
            "citations": [serialize_citation_reference(item) for item in citation_rows],
            "quotes": [serialize_quote_reference(item) for item in quote_rows],
            "notes": [serialize_note_reference(item) for item in note_rows],
            "documents": [serialize_document_reference(item) for item in document_rows],
        }
        return payload

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
