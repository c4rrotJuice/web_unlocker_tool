from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.core.serialization import serialize_research_graph
from app.modules.research.common import normalize_uuid
class ResearchGraphService:
    def __init__(
        self,
        *,
        sources_service,
        citations_service,
        quotes_service,
        notes_service,
        workspace_service,
        notes_repository,
    ):
        self.sources_service = sources_service
        self.citations_service = citations_service
        self.quotes_service = quotes_service
        self.notes_service = notes_service
        self.workspace_service = workspace_service
        self.notes_repository = notes_repository

    @staticmethod
    def _dedupe_rows(rows: list[dict], *, key: str = "id") -> list[dict]:
        ordered: list[dict] = []
        seen: set[str] = set()
        for row in rows:
            value = row.get(key)
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(row)
        return ordered

    @staticmethod
    def _dedupe_edges(edges: list[dict[str, object]]) -> list[dict[str, object]]:
        ordered: list[dict[str, object]] = []
        seen: set[tuple[str, str, str, str, str]] = set()
        for edge in edges:
            from_node = edge.get("from") or {}
            to_node = edge.get("to") or {}
            key = (
                str(from_node.get("type") or ""),
                str(from_node.get("id") or ""),
                str(to_node.get("type") or ""),
                str(to_node.get("id") or ""),
                str(edge.get("relation_type") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            ordered.append(edge)
        return ordered

    @staticmethod
    def _edge(
        *,
        from_type: str,
        from_id: str,
        to_type: str,
        to_id: str,
        relation_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, object]:
        return {
            "from": {"type": from_type, "id": from_id},
            "to": {"type": to_type, "id": to_id},
            "relation_type": relation_type,
            "metadata": metadata or {},
        }

    async def _documents_from_relations(
        self,
        *,
        user_id: str,
        access_token: str | None,
        capability_state,
        citation_ids: list[str],
        note_ids: list[str],
    ) -> list[dict]:
        citation_rows = await self.workspace_service.list_documents_for_citation_ids(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids,
        )
        note_rows = await self.workspace_service.list_documents_for_note_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=note_ids,
        )
        document_ids: list[str] = []
        seen_document_ids: set[str] = set()
        for row in [*citation_rows, *note_rows]:
            document_id = row.get("document_id")
            if document_id and document_id not in seen_document_ids:
                seen_document_ids.add(document_id)
                document_ids.append(document_id)
        return await self.workspace_service.list_documents_by_ids(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_ids=document_ids,
        )

    async def _build_graph(
        self,
        *,
        user_id: str,
        access_token: str | None,
        capability_state,
        node_type: str,
        node_data: dict[str, Any],
        citations: list[dict],
        quotes: list[dict],
        notes: list[dict],
        documents: list[dict],
        supporting_rows: list[dict] | None = None,
    ) -> dict[str, object]:
        citations = self._dedupe_rows(citations)
        quotes = self._dedupe_rows(quotes)
        notes = self._dedupe_rows(notes)
        documents = self._dedupe_rows(documents)

        source_ids: list[str] = []
        seen_source_ids: set[str] = set()
        for citation in citations:
            source_id = (citation.get("source") or {}).get("id")
            if source_id and source_id not in seen_source_ids:
                seen_source_ids.add(source_id)
                source_ids.append(source_id)
        for note in notes:
            for source in note.get("sources") or []:
                source_id = source.get("source_id")
                if source_id and source_id not in seen_source_ids:
                    seen_source_ids.add(source_id)
                    source_ids.append(source_id)
        sources = await self.sources_service.list_sources_by_ids(
            user_id=user_id,
            access_token=access_token,
            source_ids=source_ids,
        )

        edges: list[dict[str, object]] = []
        for citation in citations:
            citation_id = citation.get("id")
            source_id = (citation.get("source") or {}).get("id")
            if citation_id and source_id:
                edges.append(
                    self._edge(
                        from_type="citation",
                        from_id=citation_id,
                        to_type="source",
                        to_id=source_id,
                        relation_type="citation_source",
                    )
                )
        for quote in quotes:
            quote_id = quote.get("id")
            citation_id = (quote.get("citation") or {}).get("id")
            if quote_id and citation_id:
                edges.append(
                    self._edge(
                        from_type="quote",
                        from_id=quote_id,
                        to_type="citation",
                        to_id=citation_id,
                        relation_type="quote_citation",
                    )
                )
        for note in notes:
            note_id = note.get("id")
            if not note_id:
                continue
            citation_id = note.get("citation_id")
            quote_id = note.get("quote_id")
            if citation_id:
                edges.append(
                    self._edge(
                        from_type="note",
                        from_id=note_id,
                        to_type="citation",
                        to_id=citation_id,
                        relation_type="note_citation",
                    )
                )
            if quote_id:
                edges.append(
                    self._edge(
                        from_type="note",
                        from_id=note_id,
                        to_type="quote",
                        to_id=quote_id,
                        relation_type="note_quote",
                    )
                )
            for linked_note_id in note.get("linked_note_ids") or []:
                edges.append(
                    self._edge(
                        from_type="note",
                        from_id=note_id,
                        to_type="note",
                        to_id=linked_note_id,
                        relation_type="note_link",
                    )
                )
            for source in note.get("sources") or []:
                metadata = {
                    "position": source.get("position"),
                    "citation_id": source.get("citation_id"),
                    "url": source.get("url"),
                }
                if source.get("source_id"):
                    edges.append(
                        self._edge(
                            from_type="note",
                            from_id=note_id,
                            to_type="source",
                            to_id=source["source_id"],
                            relation_type=f"note_source_{source.get('relation_type') or 'source'}",
                            metadata=metadata,
                        )
                    )
                if source.get("citation_id"):
                    edges.append(
                        self._edge(
                            from_type="note",
                            from_id=note_id,
                            to_type="citation",
                            to_id=source["citation_id"],
                            relation_type=f"note_source_{source.get('relation_type') or 'citation'}",
                            metadata={"position": source.get("position"), "source_id": source.get("source_id"), "url": source.get("url")},
                        )
                    )
        for document in documents:
            document_id = document.get("id")
            if not document_id:
                continue
            for citation_id in document.get("attached_citation_ids") or []:
                edges.append(
                    self._edge(
                        from_type="document",
                        from_id=document_id,
                        to_type="citation",
                        to_id=citation_id,
                        relation_type="document_citation",
                    )
                )
            for note_id in document.get("attached_note_ids") or []:
                edges.append(
                    self._edge(
                        from_type="document",
                        from_id=document_id,
                        to_type="note",
                        to_id=note_id,
                        relation_type="document_note",
                    )
                )

        if supporting_rows:
            for row in supporting_rows:
                note_id = row.get("note_id")
                source_id = row.get("source_id")
                citation_id = row.get("citation_id")
                if note_id and source_id:
                    edges.append(
                        self._edge(
                            from_type="note",
                            from_id=note_id,
                            to_type="source",
                            to_id=source_id,
                            relation_type=f"note_source_{row.get('relation_type') or 'source'}",
                            metadata={"position": row.get("position"), "citation_id": citation_id, "url": row.get("url")},
                        )
                    )
                if note_id and citation_id:
                    edges.append(
                        self._edge(
                            from_type="note",
                            from_id=note_id,
                            to_type="citation",
                            to_id=citation_id,
                            relation_type=f"note_source_{row.get('relation_type') or 'citation'}",
                            metadata={"position": row.get("position"), "source_id": source_id, "url": row.get("url")},
                        )
                    )

        return serialize_research_graph(
            node={"type": node_type, "id": node_data.get("id"), "data": node_data},
            sources=sources,
            citations=citations,
            quotes=quotes,
            notes=notes,
            documents=documents,
            edges=self._dedupe_edges(edges),
        )

    async def get_graph(self, *, user_id: str, access_token: str | None, capability_state, entity: str, entity_id: str) -> dict[str, object]:
        normalized_entity = (entity or "").strip().lower()
        if normalized_entity not in {"source", "citation", "quote", "note", "document"}:
            raise HTTPException(status_code=404, detail="Graph entity not found")

        if normalized_entity == "document":
            document_id = normalize_uuid(entity_id, field_name="document_id")
            payload = await self.workspace_service.hydrate_document(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                document_id=document_id,
                seed=None,
            )
            data = payload["data"]
            return serialize_ok_envelope(await self._build_graph(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                node_type="document",
                node_data=data["document"],
                citations=data["attached_citations"],
                quotes=data["attached_quotes"],
                notes=data["attached_notes"],
                documents=[data["document"]],
            ))

        if normalized_entity == "note":
            note_id = normalize_uuid(entity_id, field_name="note_id")
            note = await self.notes_service.get_note(user_id=user_id, access_token=access_token, note_id=note_id)
            citation_ids = [note.get("citation_id")] if note.get("citation_id") else []
            citation_ids.extend([source.get("citation_id") for source in note.get("sources") or [] if source.get("citation_id")])
            citations = await self.citations_service.list_citations(
                user_id=user_id,
                access_token=access_token,
                ids=list(dict.fromkeys([citation_id for citation_id in citation_ids if citation_id])),
                limit=max(len(citation_ids), 1),
            ) if citation_ids else []
            quotes = await self.quotes_service.list_quotes_by_ids(
                user_id=user_id,
                access_token=access_token,
                quote_ids=[note["quote_id"]],
            ) if note.get("quote_id") else []
            linked_notes = await self.notes_service.list_notes_by_ids(
                user_id=user_id,
                access_token=access_token,
                note_ids=note.get("linked_note_ids") or [],
            ) if note.get("linked_note_ids") else []
            documents = await self._documents_from_relations(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                citation_ids=[citation.get("id") for citation in citations if citation.get("id")],
                note_ids=[note_id],
            )
            return serialize_ok_envelope(await self._build_graph(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                node_type="note",
                node_data=note,
                citations=citations,
                quotes=quotes,
                notes=[note, *linked_notes],
                documents=documents,
            ))

        if normalized_entity == "quote":
            quote_id = normalize_uuid(entity_id, field_name="quote_id")
            quote = await self.quotes_service.get_quote(user_id=user_id, access_token=access_token, quote_id=quote_id)
            citation = quote.get("citation")
            notes = await self.notes_service.list_notes(
                user_id=user_id,
                access_token=access_token,
                quote_id=quote_id,
                limit=100,
            )
            documents = await self._documents_from_relations(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                citation_ids=[citation.get("id")] if citation and citation.get("id") else [],
                note_ids=[note.get("id") for note in notes if note.get("id")],
            )
            return serialize_ok_envelope(await self._build_graph(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                node_type="quote",
                node_data=quote,
                citations=[citation] if citation else [],
                quotes=[quote],
                notes=notes,
                documents=documents,
            ))

        if normalized_entity == "citation":
            citation_id = normalize_uuid(entity_id, field_name="citation_id")
            citation = await self.citations_service.get_citation(
                user_id=user_id,
                access_token=access_token,
                citation_id=citation_id,
                account_type=capability_state.tier,
            )
            quotes = await self.quotes_service.list_quotes(
                user_id=user_id,
                access_token=access_token,
                citation_id=citation_id,
                limit=100,
            )
            direct_notes = await self.notes_service.list_notes(
                user_id=user_id,
                access_token=access_token,
                citation_id=citation_id,
                limit=100,
            )
            supporting_rows = await self.notes_service.list_note_sources_by_citation_ids(
                user_id=user_id,
                access_token=access_token,
                citation_ids=[citation_id],
            )
            supporting_note_ids = [row.get("note_id") for row in supporting_rows if row.get("note_id")]
            supporting_notes = await self.notes_service.list_notes_by_ids(
                user_id=user_id,
                access_token=access_token,
                note_ids=list(dict.fromkeys(supporting_note_ids)),
            ) if supporting_note_ids else []
            all_notes = [*direct_notes, *supporting_notes]
            documents = await self._documents_from_relations(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                citation_ids=[citation_id],
                note_ids=[note.get("id") for note in all_notes if note.get("id")],
            )
            return serialize_ok_envelope(await self._build_graph(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                node_type="citation",
                node_data=citation,
                citations=[citation],
                quotes=quotes,
                notes=all_notes,
                documents=documents,
                supporting_rows=supporting_rows,
            ))

        source_id = normalize_uuid(entity_id, field_name="source_id")
        source = await self.sources_service.get_source(user_id=user_id, access_token=access_token, source_id=source_id)
        citations = await self.citations_service.list_citations(
            user_id=user_id,
            access_token=access_token,
            source_id=source_id,
            limit=100,
            account_type=capability_state.tier,
        )
        citation_ids = [citation.get("id") for citation in citations if citation.get("id")]
        quotes = await self.quotes_service.list_quotes(
            user_id=user_id,
            access_token=access_token,
            limit=100,
        )
        citation_id_set = set(citation_ids)
        quotes = [quote for quote in quotes if ((quote.get("citation") or {}).get("id") in citation_id_set)]
        direct_notes = await self.notes_service.list_notes(
            user_id=user_id,
            access_token=access_token,
            limit=100,
        )
        direct_notes = [note for note in direct_notes if note.get("citation_id") in citation_id_set]
        supporting_rows = await self.notes_service.list_note_sources_by_source_ids(
            user_id=user_id,
            access_token=access_token,
            source_ids=[source_id],
        )
        supporting_note_ids = [row.get("note_id") for row in supporting_rows if row.get("note_id")]
        supporting_notes = await self.notes_service.list_notes_by_ids(
            user_id=user_id,
            access_token=access_token,
            note_ids=list(dict.fromkeys(supporting_note_ids)),
        ) if supporting_note_ids else []
        all_notes = [*direct_notes, *supporting_notes]
        documents = await self._documents_from_relations(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            citation_ids=citation_ids,
            note_ids=[note.get("id") for note in all_notes if note.get("id")],
        )
        return serialize_ok_envelope(await self._build_graph(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            node_type="source",
            node_data=source,
            citations=citations,
            quotes=quotes,
            notes=all_notes,
            documents=documents,
            supporting_rows=supporting_rows,
        ))

    async def orchestrate_work_in_editor(
        self,
        *,
        user_id: str,
        access_token: str | None,
        capability_state,
        payload,
        default_document_title: str,
    ) -> dict[str, object]:
        if payload.extraction_payload is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "EXTRACTION_PAYLOAD_REQUIRED",
                    "message": "Canonical extraction payload is required.",
                },
            )
        citation = await self.citations_service.create_citation(
            user_id=user_id,
            access_token=access_token,
            account_type=capability_state.tier,
            extraction_payload=payload.extraction_payload,
            excerpt=payload.selected_text,
            quote=payload.selected_text,
            locator=payload.locator,
            annotation=None,
            style=payload.citation_format,
        )
        quote = None
        if payload.selected_text:
            quote = await self.quotes_service.create_quote(
                user_id=user_id,
                access_token=access_token,
                payload={
                    "citation_id": citation["id"],
                    "excerpt": payload.selected_text,
                    "locator": payload.locator,
                    "annotation": None,
                },
            )
        note = None
        if payload.note is not None:
            note = await self.notes_service.create_note(
                user_id=user_id,
                access_token=access_token,
                payload={
                    "title": payload.note.title or payload.title or "Captured note",
                    "note_body": payload.note.note_body,
                    "highlight_text": payload.selected_text,
                    "project_id": payload.note.project_id or payload.project_id,
                    "citation_id": citation["id"],
                    "quote_id": quote["id"] if quote else None,
                    "tag_ids": payload.note.tag_ids,
                    "sources": [source.model_dump(exclude_none=True) for source in payload.note.sources],
                    "linked_note_ids": [],
                },
            )
        document = await self.workspace_service.create_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            payload={
                "title": default_document_title,
                "project_id": payload.project_id or (payload.note.project_id if payload.note else None),
            },
        )
        document = document["data"]
        document_id = document["id"]
        revision = document.get("revision") or document.get("updated_at")
        lines: list[str] = []
        if payload.title:
            lines.append(f"{payload.title}\n")
        if quote and quote.get("excerpt"):
            lines.append(f"{quote['excerpt']}\n\n")
        elif payload.selected_text:
            lines.append(f"{payload.selected_text}\n\n")
        if note and note.get("note_body"):
            lines.append(f"{note['note_body']}\n")
        elif payload.citation_text:
            lines.append(f"Source: {payload.citation_text}\n")
        seed = {
            "ops": [{"insert": "".join(lines) or "\n"}],
            "document_id": document_id,
            "source_id": citation.get("source_id") or (citation.get("source") or {}).get("id"),
            "citation_id": citation.get("id"),
            "quote_id": quote.get("id") if quote else None,
            "note_id": note.get("id") if note else None,
            "mode": "quote_focus" if quote else "seed_review",
        }
        updated_document = await self.workspace_service.update_document(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            payload={
                "revision": revision,
                "content_delta": {"ops": seed["ops"]},
            },
        )
        document = updated_document["data"]
        revision = document.get("revision") or document.get("updated_at")
        document = await self.workspace_service.replace_document_citations(
            user_id=user_id,
            access_token=access_token,
            capability_state=capability_state,
            document_id=document_id,
            revision=revision,
            citation_ids=[citation["id"]],
        )
        revision = document["data"].get("revision") or document["data"].get("updated_at")
        if note is not None:
            document = await self.workspace_service.replace_document_notes(
                user_id=user_id,
                access_token=access_token,
                capability_state=capability_state,
                document_id=document_id,
                revision=revision,
                note_ids=[note["id"]],
            )
        return {
            "document_id": document_id,
            "document": document["data"],
            "citation": citation,
            "quote": quote,
            "note": note,
            "seed": self.workspace_service.summarize_seed(seed),
        }
