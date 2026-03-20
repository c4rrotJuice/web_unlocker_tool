from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.serialization import serialize_paging_meta
from app.core.serialization import serialize_note, serialize_note_source
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator, map_relation_error
from app.modules.research.common import normalize_uuid
from app.modules.research.notes.repo import NotesRepository


class NotesService:
    def __init__(
        self,
        *,
        repository: NotesRepository,
        taxonomy_service,
        citations_service,
        ownership: OwnershipValidator,
        relation_validation: RelationValidator,
    ):
        self.repository = repository
        self.taxonomy_service = taxonomy_service
        self.citations_service = citations_service
        self.ownership = ownership
        self.relation_validation = relation_validation

    async def _validate_note_source_references(self, *, user_id: str, access_token: str | None, sources: list[dict]) -> None:
        citation_ids: list[str] = []
        source_ids: list[str] = []
        for source in sources:
            relation_type = str(source.get("relation_type") or "external")
            source_id = source.get("source_id")
            citation_id = source.get("citation_id")
            url = source.get("url")
            if relation_type not in {"external", "source", "citation"}:
                raise HTTPException(status_code=422, detail="Invalid note source relation type")
            if relation_type == "external" and not url:
                raise HTTPException(status_code=422, detail="External note sources require a URL")
            if source_id:
                source_ids.append(str(source_id))
            if citation_id:
                citation_ids.append(str(citation_id))
            if relation_type == "source" and not source_id:
                raise HTTPException(status_code=422, detail="Source note references require source_id")
            if relation_type == "citation" and not citation_id:
                raise HTTPException(status_code=422, detail="Citation note references require citation_id")
        if citation_ids:
            await self.relation_validation.validate_owned_citation_ids(
                user_id=user_id,
                access_token=access_token,
                citation_ids=citation_ids,
            )
        if source_ids:
            normalized_source_ids = self.relation_validation.normalize_relation_ids(source_ids, field_name="source_id")
            source_rows = await self.citations_service.sources_service.repository.get_sources_by_ids(
                source_ids=normalized_source_ids,
                access_token=access_token,
            )
            source_id_set = {row.get("id") for row in source_rows if row.get("id")}
            if any(source_id not in source_id_set for source_id in normalized_source_ids):
                raise HTTPException(status_code=422, detail="Invalid source references")

    async def _hydrate(self, *, user_id: str, access_token: str | None, rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        note_ids = [row.get("id") for row in rows if row.get("id")]
        tag_links = await self.repository.list_note_tag_links(user_id=user_id, access_token=access_token, note_ids=note_ids)
        tag_ids: list[str] = []
        seen_tag_ids: set[str] = set()
        for link in tag_links:
            tag_id = link.get("tag_id")
            if tag_id and tag_id not in seen_tag_ids:
                seen_tag_ids.add(tag_id)
                tag_ids.append(tag_id)
        tags = await self.taxonomy_service.resolve_tags(
            user_id=user_id,
            access_token=access_token,
            tag_ids=tag_ids,
            names=[],
        ) if tag_ids else []
        tags_by_id = {tag.get("id"): tag for tag in tags if tag.get("id")}
        tags_by_note: dict[str, list[dict]] = {note_id: [] for note_id in note_ids if note_id}
        for link in tag_links:
            note_id = link.get("note_id")
            tag = tags_by_id.get(link.get("tag_id"))
            if note_id and tag:
                tags_by_note.setdefault(note_id, []).append(tag)

        source_rows = await self.repository.list_note_sources(user_id=user_id, access_token=access_token, note_ids=note_ids)
        sources_by_note: dict[str, list[dict]] = {note_id: [] for note_id in note_ids if note_id}
        for source_row in source_rows:
            note_id = source_row.get("note_id")
            if not note_id:
                continue
            hydrated_source = serialize_note_source(
                {
                    **source_row,
                    "display": {
                        "label": source_row.get("title") or source_row.get("url"),
                        "subtitle": source_row.get("hostname"),
                    },
                }
            )
            sources_by_note.setdefault(note_id, []).append(hydrated_source)

        link_rows = await self.repository.list_note_links(user_id=user_id, access_token=access_token, note_ids=note_ids)
        linked_ids_by_note: dict[str, list[str]] = {note_id: [] for note_id in note_ids if note_id}
        for row in link_rows:
            note_id = row.get("note_id")
            linked_note_id = row.get("linked_note_id")
            if note_id and linked_note_id:
                linked_ids_by_note.setdefault(note_id, []).append(linked_note_id)

        return [
            serialize_note(
                row,
                tags=tags_by_note.get(row.get("id"), []),
                linked_note_ids=linked_ids_by_note.get(row.get("id"), []),
                sources=sources_by_note.get(row.get("id"), []),
            )
            for row in rows
        ]

    async def list_notes(
        self,
        *,
        user_id: str,
        access_token: str | None,
        project_id: str | None = None,
        tag_id: str | None = None,
        citation_id: str | None = None,
        quote_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        if project_id:
            project_id = await self.taxonomy_service.ensure_project_exists(
                user_id=user_id,
                access_token=access_token,
                project_id=project_id,
            )
        if citation_id:
            normalized = await self.relation_validation.validate_owned_citation_ids(
                user_id=user_id,
                access_token=access_token,
                citation_ids=[citation_id],
            )
            citation_id = normalized[0]
        if quote_id:
            quote_id = normalize_uuid(quote_id, field_name="quote_id")
        rows = await self.repository.list_notes(
            user_id=user_id,
            access_token=access_token,
            project_id=project_id,
            citation_id=citation_id,
            quote_id=quote_id,
            status=status,
            query=query,
            limit=limit,
            offset=offset,
        )
        hydrated = await self._hydrate(user_id=user_id, access_token=access_token, rows=rows)
        if tag_id:
            normalized_tag_id = normalize_uuid(tag_id, field_name="tag_id")
            hydrated = [
                item for item in hydrated
                if any(tag.get("id") == normalized_tag_id for tag in item.get("tags", []))
            ]
        return hydrated

    async def list_notes_page(
        self,
        *,
        user_id: str,
        access_token: str | None,
        project_id: str | None = None,
        tag_id: str | None = None,
        citation_id: str | None = None,
        quote_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> dict[str, object]:
        offset = int(cursor or "0")
        batch_limit = limit + 1
        items = await self.list_notes(
            user_id=user_id,
            access_token=access_token,
            project_id=project_id,
            tag_id=tag_id,
            citation_id=citation_id,
            quote_id=quote_id,
            status=status,
            query=query,
            limit=batch_limit,
            offset=offset,
        )
        has_more = len(items) > limit
        page_items = items[:limit]
        next_cursor = str(offset + limit) if has_more else None
        return {
            "items": page_items,
            "meta": serialize_paging_meta(next_cursor=next_cursor, has_more=has_more),
        }

    async def get_note(self, *, user_id: str, access_token: str | None, note_id: str) -> dict:
        row = await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=note_id,
            access_token=access_token,
            select="id,title,note_body,highlight_text,project_id,citation_id,quote_id,status,archived_at,created_at,updated_at",
        )
        hydrated = await self._hydrate(user_id=user_id, access_token=access_token, rows=[row])
        return hydrated[0]

    async def create_note(self, *, user_id: str, access_token: str | None, payload: dict) -> dict:
        project_id = await self.taxonomy_service.ensure_project_exists(
            user_id=user_id,
            access_token=access_token,
            project_id=payload.get("project_id"),
        ) if payload.get("project_id") else None
        citation_id, quote_id = await self._normalize_citation_lineage(
            user_id=user_id,
            access_token=access_token,
            citation_id=payload.get("citation_id"),
            quote_id=payload.get("quote_id"),
        )
        linked_note_ids = await self.relation_validation.validate_owned_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=self.relation_validation.normalize_relation_ids(payload.get("linked_note_ids") or [], field_name="linked_note_id"),
        ) if payload.get("linked_note_ids") else []
        row = await self.repository.create_note(
            user_id=user_id,
            access_token=access_token,
            payload={
                **payload,
                "project_id": project_id,
                "citation_id": citation_id,
                "quote_id": quote_id,
            },
        )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create note")
        note_id = str(row["id"])
        await self.replace_note_tags(user_id=user_id, access_token=access_token, note_id=note_id, tag_ids=payload.get("tag_ids") or [])
        await self.replace_note_sources(user_id=user_id, access_token=access_token, note_id=note_id, sources=payload.get("sources") or [])
        await self.replace_note_links(user_id=user_id, access_token=access_token, note_id=note_id, linked_note_ids=linked_note_ids)
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=note_id)

    async def list_notes_by_ids(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        normalized_note_ids = self.relation_validation.normalize_relation_ids(note_ids, field_name="note_id")
        rows = await self.repository.list_notes_by_ids(user_id=user_id, access_token=access_token, note_ids=normalized_note_ids)
        return await self._hydrate(user_id=user_id, access_token=access_token, rows=rows)

    async def update_note(self, *, user_id: str, access_token: str | None, note_id: str, payload: dict) -> dict:
        existing = await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=note_id,
            access_token=access_token,
            select="id,citation_id,quote_id",
        )
        patch_payload = dict(payload)
        if payload.get("project_id") is not None:
            patch_payload["project_id"] = await self.taxonomy_service.ensure_project_exists(
                user_id=user_id,
                access_token=access_token,
                project_id=payload.get("project_id"),
            ) if payload.get("project_id") else None
        if payload.get("citation_id") is not None or payload.get("quote_id") is not None:
            next_citation_id, next_quote_id = await self._normalize_citation_lineage(
                user_id=user_id,
                access_token=access_token,
                citation_id=payload.get("citation_id") if payload.get("citation_id") is not None else existing.get("citation_id"),
                quote_id=payload.get("quote_id") if payload.get("quote_id") is not None else existing.get("quote_id"),
            )
            if payload.get("citation_id") is not None:
                patch_payload["citation_id"] = next_citation_id
            if payload.get("quote_id") is not None:
                patch_payload["quote_id"] = next_quote_id
        row = await self.repository.update_note(
            user_id=user_id,
            access_token=access_token,
            note_id=normalize_uuid(note_id, field_name="note_id"),
            payload=patch_payload,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Note not found")
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=str(row["id"]))

    async def delete_note(self, *, user_id: str, access_token: str | None, note_id: str) -> dict:
        normalized_note_id = normalize_uuid(note_id, field_name="note_id")
        await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=normalized_note_id,
            access_token=access_token,
            select="id",
        )
        rows = await self.repository.delete_note(user_id=user_id, access_token=access_token, note_id=normalized_note_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Note not found")
        return {"ok": True, "id": normalized_note_id}

    async def archive_note(self, *, user_id: str, access_token: str | None, note_id: str) -> dict:
        await self.update_note(
            user_id=user_id,
            access_token=access_token,
            note_id=note_id,
            payload={"status": "archived", "archived_at": datetime.now(timezone.utc).isoformat()},
        )
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=note_id)

    async def restore_note(self, *, user_id: str, access_token: str | None, note_id: str) -> dict:
        await self.update_note(
            user_id=user_id,
            access_token=access_token,
            note_id=note_id,
            payload={"status": "active", "archived_at": None},
        )
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=note_id)

    async def replace_note_tags(self, *, user_id: str, access_token: str | None, note_id: str, tag_ids: list[str]) -> dict:
        normalized_note_id = normalize_uuid(note_id, field_name="note_id")
        await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=normalized_note_id,
            access_token=access_token,
            select="id",
        )
        normalized_tag_ids = await self.relation_validation.validate_owned_tag_ids(
            user_id=user_id,
            access_token=access_token,
            tag_ids=tag_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_note_tag_links_atomic",
            payload={"p_user_id": user_id, "p_note_id": normalized_note_id, "p_tag_ids": normalized_tag_ids},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Note not found", invalid_related_detail="Invalid tag references")
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=normalized_note_id)

    async def replace_note_sources(self, *, user_id: str, access_token: str | None, note_id: str, sources: list[dict]) -> dict:
        normalized_note_id = normalize_uuid(note_id, field_name="note_id")
        await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=normalized_note_id,
            access_token=access_token,
            select="id",
        )
        normalized_sources = self.relation_validation.normalize_note_sources(sources=sources)
        await self._validate_note_source_references(
            user_id=user_id,
            access_token=access_token,
            sources=normalized_sources,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_note_sources_atomic",
            payload={"p_user_id": user_id, "p_note_id": normalized_note_id, "p_sources": normalized_sources},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Note not found", invalid_related_detail="Invalid note sources")
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=normalized_note_id)

    async def replace_note_links(self, *, user_id: str, access_token: str | None, note_id: str, linked_note_ids: list[str]) -> dict:
        normalized_note_id = normalize_uuid(note_id, field_name="note_id")
        await self.ownership.load_owned_note(
            user_id=user_id,
            note_id=normalized_note_id,
            access_token=access_token,
            select="id",
        )
        normalized_linked_ids = self.relation_validation.validate_linked_note_ids(note_id=normalized_note_id, linked_note_ids=linked_note_ids)
        normalized_linked_ids = await self.relation_validation.validate_owned_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=normalized_linked_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_note_links_atomic",
            payload={"p_user_id": user_id, "p_note_id": normalized_note_id, "p_linked_note_ids": normalized_linked_ids},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Note not found", invalid_related_detail="Invalid linked note references")
        return await self.get_note(user_id=user_id, access_token=access_token, note_id=normalized_note_id)
    async def _normalize_citation_lineage(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str | None,
        quote_id: str | None,
    ) -> tuple[str | None, str | None]:
        normalized_citation_id = None
        if citation_id:
            normalized_citation_id = (
                await self.relation_validation.validate_owned_citation_ids(
                    user_id=user_id,
                    access_token=access_token,
                    citation_ids=[citation_id],
                )
            )[0]
        normalized_quote_id = None
        if quote_id:
            normalized_quote_id = normalize_uuid(quote_id, field_name="quote_id")
            quote_row = await self.ownership.load_owned_quote(
                user_id=user_id,
                quote_id=normalized_quote_id,
                access_token=access_token,
                select="id,citation_id",
            )
            quote_citation_id = str(quote_row.get("citation_id")) if quote_row.get("citation_id") else None
            if normalized_citation_id is None:
                normalized_citation_id = quote_citation_id
            elif quote_citation_id and normalized_citation_id != quote_citation_id:
                raise HTTPException(status_code=422, detail="quote_id and citation_id must reference the same citation")
        return normalized_citation_id, normalized_quote_id
