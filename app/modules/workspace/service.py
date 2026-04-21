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
from app.services.supabase_rest import response_error_text


class WorkspaceService:
    def __init__(
        self,
        *,
        repository: WorkspaceRepository,
        taxonomy_service,
        sources_service,
        citations_service,
        quotes_service,
        notes_service,
        activity_service=None,
        ownership: OwnershipValidator,
        relation_validation: RelationValidator,
    ):
        self.repository = repository
        self.taxonomy_service = taxonomy_service
        self.sources_service = sources_service
        self.citations_service = citations_service
        self.quotes_service = quotes_service
        self.notes_service = notes_service
        self.activity_service = activity_service
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

    @staticmethod
    def _revision_conflict_detail(
        *,
        operation: str,
        expected_revision: str,
        current_document: dict,
    ) -> dict[str, object]:
        current_revision = current_document.get("revision") or current_document.get("updated_at")
        return {
            "code": "revision_conflict",
            "message": "Document changed on another surface. Reload the latest version before saving again.",
            "operation": operation,
            "expected_revision": expected_revision,
            "current_revision": current_revision,
            "current_document": current_document,
        }

    def _raise_revision_conflict(self, *, operation: str, expected_revision: str, current_document: dict) -> None:
        raise HTTPException(
            status_code=409,
            detail=self._revision_conflict_detail(
                operation=operation,
                expected_revision=expected_revision,
                current_document=current_document,
            ),
        )

    @staticmethod
    def _is_revision_conflict_response(response) -> bool:
        return response.status_code == 409 or "revision_conflict" in response_error_text(response).lower()

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
        project_ids: list[str] = []
        seen_project_ids: set[str] = set()
        for row in rows:
            project_id = row.get("project_id")
            if project_id and project_id not in seen_project_ids:
                seen_project_ids.add(project_id)
                project_ids.append(project_id)

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
        projects = await self.taxonomy_service.list_projects(user_id=user_id, access_token=access_token, include_archived=True, limit=max(len(project_ids), 1)) if project_ids else []
        tags_by_id = {tag.get("id"): tag for tag in tags if tag.get("id")}
        projects_by_id = {project.get("id"): project for project in projects if project.get("id")}
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
                    project=projects_by_id.get(row.get("project_id")),
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

    async def _load_document_for_write(self, *, user_id: str, access_token: str | None, document_id: str) -> dict:
        return await self.ownership.load_owned_document(
            user_id=user_id,
            document_id=document_id,
            access_token=access_token,
            select="id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at",
        )

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

    async def list_documents_for_citation_ids(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> list[dict]:
        return await self.repository.list_documents_for_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
        )

    async def list_documents_for_note_ids(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        return await self.repository.list_documents_for_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=note_ids,
        )

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
        if self.activity_service is not None:
            await self.activity_service.record_event(
                user_id=user_id,
                event_type="document_updated",
                entity_id=str(row.get("id") or ""),
                idempotency_key=f"document-created:{row.get('id')}",
            )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=str(row["id"]))

    async def update_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, payload: dict) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        current_document = await self._load_document_for_write(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
        )
        expected_revision = str(payload.get("revision") or "").strip()
        if not expected_revision:
            raise HTTPException(status_code=422, detail="revision is required")
        current_revision = str(current_document.get("updated_at") or "")
        if current_revision and expected_revision != current_revision:
            self._raise_revision_conflict(
                operation="update_document",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        patch_payload = dict(payload)
        patch_payload.pop("revision", None)
        if payload.get("project_id") is not None:
            patch_payload["project_id"] = await self.taxonomy_service.ensure_project_exists(
                user_id=user_id,
                access_token=access_token,
                project_id=payload.get("project_id"),
            ) if payload.get("project_id") else None
        row = await self.repository.update_document(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            expected_revision=expected_revision,
            payload=patch_payload,
        )
        if row is None:
            current = await self.repository.get_document(
                user_id=user_id,
                access_token=access_token,
                document_id=normalized_document_id,
            )
            if current is None:
                raise HTTPException(status_code=404, detail="Document not found")
            self._raise_revision_conflict(
                operation="update_document",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        if self.activity_service is not None:
            await self.activity_service.record_event(
                user_id=user_id,
                event_type="document_updated",
                entity_id=str(row.get("id") or ""),
                idempotency_key=f"document-updated:{row.get('id')}:{expected_revision}",
            )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=str(row["id"]))

    async def archive_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str) -> dict:
        await self.update_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            payload={"status": "archived", "archived_at": datetime.now(timezone.utc).isoformat(), "revision": (await self._load_document_for_write(user_id=user_id, access_token=access_token, document_id=normalize_uuid(document_id, field_name="document_id"))).get("updated_at")},
        )
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=document_id)

    async def restore_document(self, *, user_id: str, access_token: str | None, capability_state, document_id: str) -> dict:
        await self.update_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            payload={"status": "active", "archived_at": None, "revision": (await self._load_document_for_write(user_id=user_id, access_token=access_token, document_id=normalize_uuid(document_id, field_name="document_id"))).get("updated_at")},
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

    async def replace_document_citations(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, revision: str, citation_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        current_document = await self._load_document_for_write(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
        )
        expected_revision = str(revision or "").strip()
        if not expected_revision:
            raise HTTPException(status_code=422, detail="revision is required")
        current_revision = str(current_document.get("updated_at") or "")
        if current_revision and expected_revision != current_revision:
            self._raise_revision_conflict(
                operation="replace_document_citations",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        normalized_citation_ids = await self.relation_validation.validate_owned_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_citations_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_expected_revision": expected_revision, "p_citation_ids": normalized_citation_ids},
        )
        if self._is_revision_conflict_response(response):
            self._raise_revision_conflict(
                operation="replace_document_citations",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Document not found", invalid_related_detail="Invalid citation references")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def replace_document_notes(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, revision: str, note_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        current_document = await self._load_document_for_write(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
        )
        expected_revision = str(revision or "").strip()
        if not expected_revision:
            raise HTTPException(status_code=422, detail="revision is required")
        current_revision = str(current_document.get("updated_at") or "")
        if current_revision and expected_revision != current_revision:
            self._raise_revision_conflict(
                operation="replace_document_notes",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        normalized_note_ids = await self.relation_validation.validate_owned_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=note_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_notes_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_expected_revision": expected_revision, "p_note_ids": normalized_note_ids},
        )
        if self._is_revision_conflict_response(response):
            self._raise_revision_conflict(
                operation="replace_document_notes",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        if response.status_code != 200:
            raise map_relation_error(response, missing_parent_detail="Document not found", invalid_related_detail="Invalid note references")
        return await self.get_document(user_id=user_id, access_token=access_token, capability_state=capability_state, document_id=normalized_document_id)

    async def replace_document_tags(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, revision: str, tag_ids: list[str]) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        current_document = await self._load_document_for_write(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
        )
        expected_revision = str(revision or "").strip()
        if not expected_revision:
            raise HTTPException(status_code=422, detail="revision is required")
        current_revision = str(current_document.get("updated_at") or "")
        if current_revision and expected_revision != current_revision:
            self._raise_revision_conflict(
                operation="replace_document_tags",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        normalized_tag_ids = await self.relation_validation.validate_owned_tag_ids(
            user_id=user_id,
            access_token=access_token,
            tag_ids=tag_ids,
        )
        response, _ = await self.repository.call_replace_rpc(
            function_name="replace_document_tags_atomic",
            payload={"p_user_id": user_id, "p_document_id": normalized_document_id, "p_expected_revision": expected_revision, "p_tag_ids": normalized_tag_ids},
        )
        if self._is_revision_conflict_response(response):
            self._raise_revision_conflict(
                operation="replace_document_tags",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
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

    async def restore_checkpoint(self, *, user_id: str, access_token: str | None, capability_state, document_id: str, checkpoint_id: str, revision: str) -> dict:
        normalized_document_id = normalize_uuid(document_id, field_name="document_id")
        current_document = await self._load_document_for_write(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
        )
        expected_revision = str(revision or "").strip()
        if not expected_revision:
            raise HTTPException(status_code=422, detail="revision is required")
        if str(current_document.get("updated_at") or "") != expected_revision:
            self._raise_revision_conflict(
                operation="restore_checkpoint",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
            )
        checkpoint = await self.repository.get_checkpoint(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            checkpoint_id=normalize_uuid(checkpoint_id, field_name="checkpoint_id"),
        )
        if checkpoint is None:
            raise HTTPException(status_code=404, detail="Checkpoint not found")
        row = await self.repository.update_document(
            user_id=user_id,
            access_token=access_token,
            document_id=normalized_document_id,
            expected_revision=expected_revision,
            payload={
                "content_delta": checkpoint.get("content_delta") or {"ops": [{"insert": "\n"}]},
                "content_html": checkpoint.get("content_html"),
            },
        )
        if row is None:
            current = await self.repository.get_document(
                user_id=user_id,
                access_token=access_token,
                document_id=normalized_document_id,
            )
            if current is None:
                raise HTTPException(status_code=404, detail="Document not found")
            self._raise_revision_conflict(
                operation="restore_checkpoint",
                expected_revision=expected_revision,
                current_document=(await self.get_document(
                    user_id=user_id,
                    access_token=access_token,
                    capability_state=capability_state,
                    document_id=normalized_document_id,
                ))["data"],
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
        source_ids: list[str] = []
        seen_source_ids: set[str] = set()
        for citation in attached_citations:
            source = citation.get("source") or {}
            source_id = source.get("id")
            if source_id and source_id not in seen_source_ids:
                seen_source_ids.add(source_id)
                source_ids.append(source_id)
        for note in ordered_notes:
            for evidence_link in note.get("evidence_links") or []:
                source_id = evidence_link.get("source_id")
                if source_id and source_id not in seen_source_ids:
                    seen_source_ids.add(source_id)
                    source_ids.append(source_id)
        derived_sources = await self.sources_service.list_sources_by_ids(
            user_id=user_id,
            access_token=access_token,
            source_ids=source_ids,
        ) if source_ids else []
        compact_seed = self.summarize_seed(seed)
        return serialize_ok_envelope(
            serialize_document_hydration(
                document=document,
                attached_citations=attached_citations,
                attached_notes=ordered_notes,
                attached_quotes=attached_quotes,
                derived_sources=derived_sources,
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
            project=None,
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
