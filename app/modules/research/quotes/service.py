from __future__ import annotations

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.core.serialization import serialize_paging_meta
from app.core.serialization import serialize_document_reference, serialize_note_reference, serialize_quote
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator
from app.modules.research.common import normalize_uuid
from app.modules.research.quotes.repo import QuotesRepository


class QuotesService:
    def __init__(
        self,
        *,
        repository: QuotesRepository,
        citations_service,
        notes_service,
        workspace_repository=None,
        ownership: OwnershipValidator,
        relation_validation: RelationValidator,
        activity_service=None,
    ):
        self.repository = repository
        self.citations_service = citations_service
        self.notes_service = notes_service
        self.workspace_repository = workspace_repository
        self.ownership = ownership
        self.relation_validation = relation_validation
        self.activity_service = activity_service

    async def _serialize_rows(self, *, user_id: str, access_token: str | None, rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        quote_ids = [row.get("id") for row in rows if row.get("id")]
        citation_ids = []
        seen_citations: set[str] = set()
        for row in rows:
            citation_id = row.get("citation_id")
            if citation_id and citation_id not in seen_citations:
                seen_citations.add(citation_id)
                citation_ids.append(citation_id)
        note_ids_by_quote = await self.repository.list_note_ids_by_quote_ids(
            user_id=user_id,
            access_token=access_token,
            quote_ids=[quote_id for quote_id in quote_ids if quote_id],
        )
        citations = await self.citations_service.list_citations(
            user_id=user_id,
            access_token=access_token,
            ids=citation_ids,
            limit=len(citation_ids) or 1,
        )
        citations_by_id = {citation.get("id"): citation for citation in citations if citation.get("id")}
        return [
            serialize_quote(
                row,
                citation=citations_by_id.get(row.get("citation_id")),
                note_ids=note_ids_by_quote.get(row.get("id"), []),
            )
            for row in rows
        ]

    @staticmethod
    def _filter_serialized_quotes_by_query(*, rows: list[dict], query: str | None) -> list[dict]:
        if not query or not query.strip():
            return rows
        needle = query.strip().lower()
        return [
            item for item in rows
            if needle in str(item.get("excerpt") or "").lower()
            or needle in str(((item.get("citation") or {}).get("source") or {}).get("title") or "").lower()
        ]

    async def list_quotes(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str | None = None,
        document_id: str | None = None,
        project_id: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        if project_id:
            raise HTTPException(status_code=422, detail="Quote project filtering is not defined by the canonical workflow contract")
        if citation_id:
            normalize_uuid(citation_id, field_name="citation_id")
        if document_id:
            rows = await self._list_quotes_for_document(
                user_id=user_id,
                access_token=access_token,
                document_id=document_id,
                query=query,
                limit=limit,
            )
        else:
            rows = await self.repository.list_quotes(
                user_id=user_id,
                access_token=access_token,
                citation_id=citation_id,
                query=query,
                limit=limit,
                offset=offset,
            )
        serialized = await self._serialize_rows(user_id=user_id, access_token=access_token, rows=rows)
        return self._filter_serialized_quotes_by_query(rows=serialized, query=query)

    async def list_quotes_page(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str | None = None,
        document_id: str | None = None,
        project_id: str | None = None,
        query: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> dict[str, object]:
        offset = int(cursor or "0")
        batch_limit = limit + 1
        items = await self.list_quotes(
            user_id=user_id,
            access_token=access_token,
            citation_id=citation_id,
            document_id=document_id,
            project_id=project_id,
            query=query,
            limit=batch_limit,
            offset=offset,
        )
        has_more = len(items) > limit
        page_items = items[:limit]
        next_cursor = str(offset + limit) if has_more else None
        return serialize_ok_envelope(page_items, meta=serialize_paging_meta(next_cursor=next_cursor, has_more=has_more))

    async def _list_quotes_for_document(
        self,
        *,
        user_id: str,
        access_token: str | None,
        document_id: str,
        query: str | None,
        limit: int,
    ) -> list[dict]:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        citation_ids_in_order, raw_rows = await self.repository.list_quotes_for_document(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            query=query,
        )
        if not citation_ids_in_order:
            return []
        citation_id_set = set(citation_ids_in_order)
        grouped: dict[str, list[dict]] = {}
        for row in raw_rows:
            citation_id = row.get("citation_id")
            if citation_id in citation_id_set:
                grouped.setdefault(citation_id, []).append(row)
        ordered: list[dict] = []
        seen_quote_ids: set[str] = set()
        for citation_id in citation_ids_in_order:
            for row in grouped.get(citation_id, []):
                quote_id = row.get("id")
                if quote_id and quote_id not in seen_quote_ids:
                    seen_quote_ids.add(quote_id)
                    ordered.append(row)
                    if len(ordered) >= limit:
                        return ordered
        return ordered

    async def get_quote(self, *, user_id: str, access_token: str | None, quote_id: str) -> dict:
        row = await self.ownership.load_owned_quote(
            user_id=user_id,
            quote_id=quote_id,
            access_token=access_token,
            select="id,citation_id,excerpt,locator,annotation,created_at,updated_at",
        )
        serialized = await self._serialize_rows(user_id=user_id, access_token=access_token, rows=[row])
        payload = serialized[0]
        note_rows = await self.notes_service.list_notes_by_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=payload.get("note_ids") or [],
        ) if payload.get("note_ids") else []
        document_rows = []
        if self.workspace_repository is not None and payload.get("citation") and (payload.get("citation") or {}).get("id"):
            document_links = await self.workspace_repository.list_documents_for_citation_ids(
                user_id=user_id,
                access_token=access_token,
                citation_ids=[payload["citation"]["id"]],
            )
            document_ids = []
            seen_document_ids: set[str] = set()
            for link in document_links:
                document_id = link.get("document_id")
                if document_id and document_id not in seen_document_ids:
                    seen_document_ids.add(document_id)
                    document_ids.append(document_id)
            if document_ids:
                document_rows = await self.workspace_repository.list_documents_by_ids(
                    user_id=user_id,
                    access_token=access_token,
                    document_ids=document_ids,
                    summary_only=True,
                )
        payload["neighborhood"] = {
            "citation": payload.get("citation"),
            "notes": [serialize_note_reference(item) for item in note_rows],
            "documents": [serialize_document_reference(item) for item in document_rows],
        }
        return payload

    async def list_quotes_by_ids(self, *, user_id: str, access_token: str | None, quote_ids: list[str]) -> list[dict]:
        normalized_quote_ids = [normalize_uuid(quote_id, field_name="quote_id") for quote_id in quote_ids]
        rows = await self.repository.list_quotes(
            user_id=user_id,
            access_token=access_token,
            quote_ids=normalized_quote_ids,
        )
        return await self._serialize_rows(user_id=user_id, access_token=access_token, rows=rows)

    async def create_quote(self, *, user_id: str, access_token: str | None, payload: dict) -> dict:
        citation_ids = await self.relation_validation.validate_owned_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=[payload["citation_id"]],
        )
        row = await self.repository.create_quote(
            user_id=user_id,
            access_token=access_token,
            payload={**payload, "citation_id": citation_ids[0]},
        )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create quote")
        if self.activity_service is not None:
            await self.activity_service.record_event(
                user_id=user_id,
                event_type="quote_saved",
                entity_id=str(row.get("id") or ""),
                idempotency_key=f"quote-created:{row.get('id')}",
            )
        return await self.get_quote(user_id=user_id, access_token=access_token, quote_id=str(row["id"]))

    async def update_quote(self, *, user_id: str, access_token: str | None, quote_id: str, payload: dict) -> dict:
        await self.ownership.load_owned_quote(
            user_id=user_id,
            quote_id=quote_id,
            access_token=access_token,
            select="id",
        )
        row = await self.repository.update_quote(
            user_id=user_id,
            access_token=access_token,
            quote_id=normalize_uuid(quote_id, field_name="quote_id"),
            payload=payload,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Quote not found")
        return await self.get_quote(user_id=user_id, access_token=access_token, quote_id=str(row["id"]))

    async def delete_quote(self, *, user_id: str, access_token: str | None, quote_id: str) -> dict:
        normalized_quote_id = normalize_uuid(quote_id, field_name="quote_id")
        await self.ownership.load_owned_quote(
            user_id=user_id,
            quote_id=normalized_quote_id,
            access_token=access_token,
            select="id",
        )
        rows = await self.repository.delete_quote(user_id=user_id, access_token=access_token, quote_id=normalized_quote_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Quote not found")
        return {"ok": True, "id": normalized_quote_id}

    async def create_note_from_quote(self, *, user_id: str, access_token: str | None, quote_id: str, payload: dict) -> dict:
        quote_row = await self.ownership.load_owned_quote(
            user_id=user_id,
            quote_id=quote_id,
            access_token=access_token,
            select="id,citation_id,excerpt,locator,annotation,created_at,updated_at",
        )
        await self.relation_validation.validate_owned_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=[str(quote_row["citation_id"])],
        )
        note_payload = {
            "title": payload["title"],
            "note_body": payload["note_body"],
            "highlight_text": quote_row.get("excerpt") or payload["note_body"],
            "project_id": payload.get("project_id"),
            "citation_id": quote_row.get("citation_id"),
            "quote_id": quote_row.get("id"),
            "tag_ids": payload.get("tag_ids") or [],
            "evidence_links": [],
            "note_links": [],
        }
        return await self.notes_service.create_note(user_id=user_id, access_token=access_token, payload=note_payload)
