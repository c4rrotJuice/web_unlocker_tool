from __future__ import annotations

import re

from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.serialization import (
    serialize_checkpoint,
    serialize_document,
    serialize_document_hydration,
    serialize_module_status,
    serialize_ok_envelope,
    serialize_outline,
)
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator, map_relation_error
from app.modules.research.common import normalize_uuid
from app.modules.workspace.repo import WorkspaceRepository


class WorkspaceService:
    def __init__(
        self,
        *,
        repository: WorkspaceRepository,
        taxonomy_service,
        citations_service,
        quotes_service,
        notes_service,
        ownership: OwnershipValidator,
        relation_validation: RelationValidator,
    ):
        self.repository = repository
        self.taxonomy_service = taxonomy_service
        self.citations_service = citations_service
        self.quotes_service = quotes_service
        self.notes_service = notes_service
        self.ownership = ownership
        self.relation_validation = relation_validation

    @staticmethod
    def summarize_seed(seed: dict | None) -> dict | None:
        if not isinstance(seed, dict):
            return None
        return {
            "document_id": seed.get("document_id"),
            "source_id": seed.get("source_id"),
            "citation_id": seed.get("citation_id"),
            "quote_id": seed.get("quote_id"),
            "note_id": seed.get("note_id"),
            "mode": seed.get("mode") or "seed_review",
        }

    def status(self) -> dict[str, object]:
        return serialize_module_status(
            module="workspace",
            contract="writior_v2_phase4",
            notes=[
                "Workspace writes are canonical and relation replacement uses atomic RPCs only.",
                "Document hydration is derived, compact, and deterministic.",
            ],
        )

    def _access_state(self, *, capability_state, document_row: dict) -> tuple[bool, list[str], str | None]:
        status = str(document_row.get("status") or "active")
        docs_caps = capability_state.capabilities["documents"]
        can_edit = status != "archived" and bool(docs_caps.get("freeze", False)) is False
        if status != "archived" and bool(docs_caps.get("freeze", False)) is True:
            can_edit = False
        edit_lock_reason = None if can_edit else ("archived" if status == "archived" else "capability_locked")
        return can_edit, sorted(capability_state.capabilities["exports"]), edit_lock_reason

    async def _hydrate_documents(self, *, user_id: str, access_token: str | None, capability_state, rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        document_ids = [row.get("id") for row in rows if row.get("id")]
        citation_rows = await self.repository.list_relation_rows(table="document_citations", user_id=user_id, access_token=access_token, document_ids=document_ids)
        note_rows = await self.repository.list_relation_rows(table="document_notes", user_id=user_id, access_token=access_token, document_ids=document_ids)
        tag_rows = await self.repository.list_relation_rows(table="document_tags", user_id=user_id, access_token=access_token, document_ids=document_ids)

        citation_ids: list[str] = []
        seen_citation_ids: set[str] = set()
        for row in citation_rows:
            citation_id = row.get("citation_id")
            if citation_id and citation_id not in seen_citation_ids:
                seen_citation_ids.add(citation_id)
                citation_ids.append(citation_id)
        note_ids: list[str] = []
        seen_note_ids: set[str] = set()
        for row in note_rows:
            note_id = row.get("note_id")
            if note_id and note_id not in seen_note_ids:
                seen_note_ids.add(note_id)
                note_ids.append(note_id)
        tag_ids: list[str] = []
        seen_tag_ids: set[str] = set()
        for row in tag_rows:
            tag_id = row.get("tag_id")
            if tag_id and tag_id not in seen_tag_ids:
                seen_tag_ids.add(tag_id)
                tag_ids.append(tag_id)

        tags = await self.taxonomy_service.resolve_tags(user_id=user_id, access_token=access_token, tag_ids=tag_ids, names=[]) if tag_ids else []
        tags_by_id = {tag.get("id"): tag for tag in tags if tag.get("id")}
        citations_by_doc: dict[str, list[str]] = {document_id: [] for document_id in document_ids if document_id}
        notes_by_doc: dict[str, list[str]] = {document_id: [] for document_id in document_ids if document_id}
        tag_ids_by_doc: dict[str, list[str]] = {document_id: [] for document_id in document_ids if document_id}
        tags_by_doc: dict[str, list[dict]] = {document_id: [] for document_id in document_ids if document_id}

        for row in citation_rows:
            if row.get("document_id") and row.get("citation_id"):
                citations_by_doc.setdefault(row["document_id"], []).append(row["citation_id"])
        for row in note_rows:
            if row.get("document_id") and row.get("note_id"):
                notes_by_doc.setdefault(row["document_id"], []).append(row["note_id"])
        for row in tag_rows:
            document_id = row.get("document_id")
            tag_id = row.get("tag_id")
            if document_id and tag_id:
                tag_ids_by_doc.setdefault(document_id, []).append(tag_id)
                tag = tags_by_id.get(tag_id)
                if tag:
                    tags_by_doc.setdefault(document_id, []).append(tag)

        serialized: list[dict] = []
        for row in rows:
            can_edit, allowed_export_formats, edit_lock_reason = self._access_state(capability_state=capability_state, document_row=row)
            document_id = row.get("id")
            serialized.append(
                serialize_document(
                    row,
                    attached_citation_ids=citations_by_doc.get(document_id, []),
                    attached_note_ids=notes_by_doc.get(document_id, []),
                    tag_ids=tag_ids_by_doc.get(document_id, []),
                    tags=tags_by_doc.get(document_id, []),
                    can_edit=can_edit,
                    allowed_export_formats=allowed_export_formats,
                    edit_lock_reason=edit_lock_reason,
                )
            )
        return serialized

    async def list_documents(
        self,
        *,
        user_id: str,
        access_token: str | None,
        capability_state,
        project_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        summary_only: bool = False,
    ) -> dict:
        if project_id:
            project_id = await self.taxonomy_service.ensure_project_exists(user_id=user_id, access_token=access_token, project_id=project_id)
        rows = await self.repository.list_documents(
            user_id=user_id,
            access_token=access_token,
            project_id=project_id,
            status=status,
            limit=limit,
            summary_only=summary_only,
        )
        return serialize_ok_envelope(await self._hydrate_documents(user_id=user_id, access_token=access_token, capability_state=capability_state, rows=rows))

    async def get_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str) -> dict:
        row = await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=document_id,
            access_token=access_token,
            select="id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at",
        )
        hydrated = await self._hydrate_documents(user_id=user_id, access_token=access_token, capability_state=capability_state, rows=[row])
        return serialize_ok_envelope(hydrated[0])

    async def list_documents_by_ids(self, *, user_id: str, access_token: str | None, capability_state, document_ids: list[str]) -> list[dict]:
        normalized_document_ids = [normalize_uuid(document_id, field_name="document_id") for document_id in document_ids]
        rows = await self.repository.list_documents_by_ids(
            user_id=user_id,
            access_token=access_token,
            document_ids=normalized_document_ids,
        )
        hydrated = await self._hydrate_documents(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            rows=rows,
        )
        by_id = {row.get("id"): row for row in hydrated if row.get("id")}
        return [by_id[document_id] for document_id in normalized_document_ids if document_id in by_id]

    async def create_document(self, *, user_id: str, access_token: str | None, capability_state, payload: dict) -> dict:
        project_id = await self.taxonomy_service.ensure_project_exists(
            user_id=user_id,
            access_token=access_token,
            project_id=payload.get("project_id"),
        ) if payload.get("project_id") else None
        row = await self.repository.create_document(
            user_id=user_id,
            access_token=access_token,
            payload={"title": payload.get("title"), "project_id": project_id, "content_delta": None, "content_html": None},
        )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create document")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=str(row["id"]))

    async def update_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, payload: dict) -> dict:
        await self.ownership.load_owned_document(user_id=user_id, document_id=document_id, access_token=access_token, select="id")
        patch_payload = dict(payload)
        if payload.get("project_id") is not None:
            patch_payload["project_id"] = await self.taxonomy_service.ensure_project_exists(
                user_id=user_id,
                access_token=access_token,
                project_id=payload.get("project_id"),
            ) if payload.get("project_id") else None
        row = await self.repository.update_document(
            user_id=user_id,
            access_token=access_token,
            document_id=normalize_uuid(document_id, field_name="document_id"),
            payload=patch_payload,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=str(row["id"]))

    async def archive_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str) -> dict:
        await self.update_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            payload={"status": "archived", "archived_at": datetime.now(timezone.utc).isoformat()},
        )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=document_id)

    async def restore_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str) -> dict:
        await self.update_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            payload={"status": "active", "archived_at": None},
        )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=document_id)

    async def delete_document(self, *, user_id: str, access_token: str | None, document_id: str) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=normalized_document_id,
            access_token=access_token,
            select="id",
        )
        rows = await self.repository.delete_document(user_id=user_id, access_token=access_token, document_id=normalized_document_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Document not found")
        return serialize_ok_envelope({"id": normalized_document_id})

    async def replace_document_citations(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, citation_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=normalized_document_id,
            access_token=access_token,
            select="id",
        )
        normalized_citation_ids = await self.relation_validation.validate_owned_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_citations_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_citation_ids": normalized_citation_ids},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Document not found", invalid_related_detail="Invalid citation references")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def replace_document_notes(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, note_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=normalized_document_id,
            access_token=access_token,
            select="id",
        )
        normalized_note_ids = await self.relation_validation.validate_owned_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=note_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_notes_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_note_ids": normalized_note_ids},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Document not found", invalid_related_detail="Invalid note references")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def replace_document_tags(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, tag_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=normalized_document_id,
            access_token=access_token,
            select="id",
        )
        normalized_tag_ids = await self.relation_validation.validate_owned_tag_ids(
            user_id=user_id,
            access_token=access_token,
            tag_ids=tag_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_tags_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_tag_ids": normalized_tag_ids},
        )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Document not found", invalid_related_detail="Invalid tag references")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def create_checkpoint(self, *, user_id: str, access_token: str | None, document_id: str, label: str | None) -> dict:
        document = await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=document_id,
            access_token=access_token,
            select="id,content_delta,content_html",
        )
        row = await self.repository.create_checkpoint(
            user_id=user_id,
            access_token=access_token,
            document_id=normalize_uuid(document_id, field_name="document_id"),
            label=label,
            content_delta=document.get("content_delta") or {"ops": [{"insert": "\n"}]},
            content_html=document.get("content_html"),
        )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create checkpoint")
        return serialize_ok_envelope(serialize_checkpoint(row))

    async def list_checkpoints(self, *, user_id: str, access_token: str | None, document_id: str, limit: int = 10) -> dict:
        await self.ownership.load_owned_document(user_id=user_id, document_id=document_id, access_token=access_token, select="id")
        rows = await self.repository.list_checkpoints(
            user_id=user_id,
            access_token=access_token,
            document_id=normalize_uuid(document_id, field_name="document_id"),
            limit=limit,
        )
        return serialize_ok_envelope([serialize_checkpoint(row) for row in rows])

    async def restore_checkpoint(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, checkpoint_id: str) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=normalized_document_id,
            access_token=access_token,
            select="id",
        )
        checkpoint = await self.repository.get_checkpoint(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            checkpoint_id=normalize_uuid(checkpoint_id, field_name="checkpoint_id"),
        )
        if checkpoint is None:
            raise HTTPException(status_code=404, detail="Checkpoint not found")
        await self.repository.update_document(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            payload={
                "content_delta": checkpoint.get("content_delta") or {"ops": [{"insert": "\n"}]},
                "content_html": checkpoint.get("content_html"),
            },
        )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def hydrate_document(
        self,
        *,
        user_id: str,
        access_token: str | None,
        capability_state,
        document_id: str,
        seed: dict | None = None,
    ) -> dict:
        document_envelope = await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=document_id)
        document = document_envelope["data"]
        attached_citations = await self.citations_service.list_citations(
            user_id=user_id,
            access_token=access_token,
            ids=document.get("attached_citation_ids") or [],
            limit=len(document.get("attached_citation_ids") or []) or 1,
            account_type=capability_state.tier,
        )
        attached_quotes = await self.quotes_service.list_quotes(
            user_id=user_id,
            access_token=access_token,
            document_id=document_id,
            limit=100,
        )
        attached_notes = await self.notes_service.list_notes_by_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=document.get("attached_note_ids") or [],
        )
        notes_by_id = {note.get("id"): note for note in attached_notes if note.get("id")}
        ordered_notes = [notes_by_id[note_id] for note_id in document.get("attached_note_ids") or [] if note_id in notes_by_id]
        attached_sources: list[dict] = []
        seen_source_ids: set[str] = set()
        for citation in attached_citations:
            source = citation.get("source") or {}
            source_id = source.get("id")
            if source_id and source_id not in seen_source_ids:
                seen_source_ids.add(source_id)
                attached_sources.append(source)
        compact_seed = self.summarize_seed(seed)
        return serialize_ok_envelope(
            serialize_document_hydration(
                document=document,
                attached_citations=attached_citations,
                attached_notes=ordered_notes,
                attached_quotes=attached_quotes,
                attached_sources=attached_sources,
                seed=compact_seed,
            )
        )

    async def outline_document(self, *, user_id: str, access_token: str | None, document_id: str) -> dict:
        row = await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=document_id,
            access_token=access_token,
            select="id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at",
        )
        document = serialize_document(
            row,
            attached_citation_ids=[],
            attached_note_ids=[],
            tag_ids=[],
            tags=[],
            can_edit=True,
            allowed_export_formats=[],
        )
        items: list[dict[str, object]] = []
        delta = document.get("content_delta") if isinstance(document.get("content_delta"), dict) else {}
        for op in delta.get("ops", []):
            attributes = op.get("attributes") if isinstance(op, dict) else {}
            heading = attributes.get("header") if isinstance(attributes, dict) else None
            text = str(op.get("insert") or "").strip() if isinstance(op, dict) else ""
            if heading and text:
                anchor = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"
                items.append({"level": int(heading), "text": text, "anchor": anchor})
        if not items and document.get("content_html"):
            for level, text in re.findall(r"<h([1-6])[^>]*>(.*?)</h\1>", str(document["content_html"]), flags=re.I | re.S):
                plain = re.sub(r"<[^>]+>", "", text).strip()
                if plain:
                    anchor = re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-") or "section"
                    items.append({"level": int(level), "text": plain, "anchor": anchor})
        return serialize_ok_envelope(serialize_outline(items))
