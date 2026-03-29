from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.modules.research.notes.service import NotesService
from app.modules.research.quotes.service import QuotesService
from app.modules.workspace.service import WorkspaceService


DOC_ID = "11111111-1111-4111-8111-111111111111"
NOTE_ID_1 = "22222222-2222-4222-8222-222222222221"
NOTE_ID_2 = "22222222-2222-4222-8222-222222222222"
QUOTE_ID_1 = "33333333-3333-4333-8333-333333333331"
QUOTE_ID_2 = "33333333-3333-4333-8333-333333333332"
QUOTE_ID_3 = "33333333-3333-4333-8333-333333333333"
CHECKPOINT_ID = "44444444-4444-4444-8444-444444444444"


class DummyCapabilityState:
    def __init__(self):
        self.capabilities = {
            "documents": {"freeze": False},
            "exports": ["pdf", "html"],
        }
        self.tier = "pro"


class FakeOwnership:
    def __init__(self, *, quotes=None, notes=None, documents=None):
        self.quotes = quotes or {}
        self.notes = notes or {}
        self.documents = documents or {}
        self.calls = []

    async def load_owned_quote(self, *, user_id, quote_id, access_token, select):
        del user_id, access_token, select
        self.calls.append(("quote", quote_id))
        row = self.quotes.get(quote_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Quote not found")
        return deepcopy(row)

    async def load_owned_note(self, *, user_id, note_id, access_token, select):
        del user_id, access_token, select
        self.calls.append(("note", note_id))
        row = self.notes.get(note_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Note not found")
        return deepcopy(row)

    async def load_owned_document(self, *, user_id, document_id, access_token, select):
        del user_id, access_token, select
        self.calls.append(("document", document_id))
        row = self.documents.get(document_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return deepcopy(row)


class FakeCitationsService:
    def __init__(self):
        self.rows = {
            "citation-a": {"id": "citation-a", "source": {"id": "source-a", "title": "Source A"}},
            "citation-b": {"id": "citation-b", "source": {"id": "source-b", "title": "Source B"}},
        }
        self.repository = self
        self.sources_service = type("FakeSourcesService", (), {})()

    async def list_citations(self, *, user_id, access_token, ids=None, limit=50, **kwargs):
        del user_id, access_token, limit, kwargs
        ordered = ids or list(self.rows)
        return [deepcopy(self.rows[citation_id]) for citation_id in ordered if citation_id in self.rows]

    async def list_citations_repo(self, *, user_id, access_token, source_id=None, citation_ids=None, limit=500):
        del user_id, access_token, source_id, limit
        rows = list(self.rows.items()) if citation_ids is None else [(citation_id, self.rows[citation_id]) for citation_id in citation_ids if citation_id in self.rows]
        return [{"id": citation_id, "source_id": "source-a" if citation_id == "citation-a" else "source-b"} for citation_id, _row in rows]

    async def list_citations_repo_passthrough(self, *, user_id, access_token, source_id=None, citation_ids=None, limit=500):
        return await self.list_citations_repo(user_id=user_id, access_token=access_token, source_id=source_id, citation_ids=citation_ids, limit=limit)

    async def get_citation(self, *, user_id, access_token, citation_id, account_type=None, selected_style=None):
        del user_id, access_token, account_type, selected_style
        row = deepcopy(self.rows[citation_id])
        row.setdefault("relationship_counts", {})
        return row


class FakeSourcesService:
    async def get_source_rows_by_ids(self, *, source_ids, access_token=None):
        del access_token
        return [{"id": source_id} for source_id in source_ids if source_id == "source-a"]

    async def list_sources_by_ids(self, *, user_id, access_token, source_ids):
        del user_id, access_token
        return [{"id": source_id, "title": f"Source {source_id[-1].upper()}", "created_at": "", "updated_at": "", "relationship_counts": {}} for source_id in source_ids if source_id in {"source-a", "source-b"}]


class FakeTaxonomyService:
    def __init__(self):
        self.tags = {
            "tag-1": {"id": "tag-1", "name": "evidence", "normalized_name": "evidence"},
            "tag-2": {"id": "tag-2", "name": "draft", "normalized_name": "draft"},
        }

    async def ensure_project_exists(self, *, user_id, access_token, project_id):
        del user_id, access_token
        return project_id

    async def resolve_tag_ids(self, *, user_id, access_token, tag_ids, names):
        del user_id, access_token, names
        for tag_id in tag_ids:
            if tag_id not in self.tags:
                raise HTTPException(status_code=422, detail="Invalid tag references")
        return tag_ids

    async def resolve_tags(self, *, user_id, access_token, tag_ids, names):
        del user_id, access_token, names
        return [deepcopy(self.tags[tag_id]) for tag_id in tag_ids if tag_id in self.tags]

    async def list_projects(self, *, user_id, access_token, include_archived=True, limit=24):
        del user_id, access_token, include_archived, limit
        return [{"id": "project-1", "name": "Project 1", "archived": False, "created_at": "", "updated_at": ""}]

    async def get_project(self, *, user_id, access_token, project_id):
        del user_id, access_token
        return {"id": project_id, "name": f"Project {project_id}", "archived": False, "created_at": "", "updated_at": ""}


class FakeRelationValidation:
    def __init__(self, *, valid_tags=None, valid_citations=None, valid_notes=None):
        self.valid_tags = set(valid_tags or {"tag-1", "tag-2"})
        self.valid_citations = set(valid_citations or {"citation-a", "citation-b"})
        self.valid_notes = set(valid_notes or {NOTE_ID_1, NOTE_ID_2})

    def normalize_relation_ids(self, raw_ids, *, field_name):
        del field_name
        deduped = []
        seen = set()
        for raw_id in raw_ids:
            if raw_id in seen:
                continue
            seen.add(raw_id)
            deduped.append(raw_id)
        return deduped

    async def validate_owned_tag_ids(self, *, user_id, access_token, tag_ids):
        del user_id, access_token
        normalized = self.normalize_relation_ids(tag_ids, field_name="tag_id")
        if any(tag_id not in self.valid_tags for tag_id in normalized):
            raise HTTPException(status_code=422, detail="Invalid tag references")
        return normalized

    async def validate_owned_citation_ids(self, *, user_id, access_token, citation_ids):
        del user_id, access_token
        normalized = self.normalize_relation_ids(citation_ids, field_name="citation_id")
        if any(citation_id not in self.valid_citations for citation_id in normalized):
            raise HTTPException(status_code=422, detail="Invalid citation references")
        return normalized

    async def validate_owned_note_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        normalized = self.normalize_relation_ids(note_ids, field_name="note_id")
        if any(note_id not in self.valid_notes for note_id in normalized):
            raise HTTPException(status_code=422, detail="Invalid note references")
        return normalized

    def validate_note_links(self, *, note_id, note_links):
        normalized = []
        seen = set()
        for link in note_links:
            linked_note_id = link.get("linked_note_id")
            link_type = link.get("link_type") or "related"
            key = (linked_note_id, link_type)
            if key in seen:
                continue
            seen.add(key)
            normalized.append({"linked_note_id": linked_note_id, "link_type": link_type})
        if note_id and any(link["linked_note_id"] == note_id for link in normalized):
            raise HTTPException(status_code=422, detail="A note cannot link to itself")
        if any(link["link_type"] not in {"supports", "contradicts", "extends", "related"} for link in normalized):
            raise HTTPException(status_code=422, detail="Invalid note link type")
        return normalized

    def normalize_note_sources(self, *, sources):
        normalized = []
        seen = set()
        for index, source in enumerate(sources):
            target_kind = source.get("target_kind") or "external"
            evidence_role = source.get("evidence_role") or "supporting"
            if target_kind not in {"external", "source", "citation"}:
                raise HTTPException(status_code=422, detail="Invalid note evidence target kind")
            if evidence_role not in {"primary", "supporting", "background"}:
                raise HTTPException(status_code=422, detail="Invalid note evidence role")
            key = (target_kind, evidence_role, source.get("url"), source.get("source_id"), source.get("citation_id"))
            if key in seen:
                continue
            seen.add(key)
            normalized.append(
                {
                    "id": source.get("id"),
                    "source_id": source.get("source_id"),
                    "citation_id": source.get("citation_id"),
                    "target_kind": target_kind,
                    "evidence_role": evidence_role,
                    "url": source.get("url"),
                    "hostname": source.get("hostname"),
                    "title": source.get("title"),
                    "source_author": source.get("source_author"),
                    "source_published_at": source.get("source_published_at"),
                    "display": {"label": source.get("title"), "subtitle": source.get("hostname")},
                    "position": source.get("position", index),
                }
            )
        return normalized


class FakeNotesRepository:
    def __init__(self):
        self.notes = {
            NOTE_ID_1: {
                "id": NOTE_ID_1,
                "title": "Note 1",
                "note_body": "Body 1",
                "highlight_text": "Highlight 1",
                "project_id": None,
                "citation_id": "citation-a",
                "quote_id": None,
                "status": "active",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            },
            NOTE_ID_2: {
                "id": NOTE_ID_2,
                "title": "Note 2",
                "note_body": "Body 2",
                "highlight_text": "Highlight 2",
                "project_id": None,
                "citation_id": "citation-b",
                "quote_id": None,
                "status": "active",
                "created_at": "2026-01-03T00:00:00+00:00",
                "updated_at": "2026-01-04T00:00:00+00:00",
            },
        }
        self.note_tag_links = {NOTE_ID_1: ["tag-1"], NOTE_ID_2: ["tag-2"]}
        self.note_sources = {
            NOTE_ID_1: [
                {
                    "id": "rel-1",
                    "note_id": NOTE_ID_1,
                    "source_id": "source-a",
                    "citation_id": "citation-a",
                    "relation_type": "citation",
                    "evidence_role": "supporting",
                    "url": "https://example.com/a",
                    "hostname": "example.com",
                    "title": "A",
                    "source_author": "Ada",
                    "source_published_at": None,
                    "attached_at": "2026-01-02T00:00:00+00:00",
                    "position": 0,
                }
            ],
            NOTE_ID_2: [],
        }
        self.note_links = {
            NOTE_ID_1: [{"linked_note_id": NOTE_ID_2, "link_type": "related"}],
            NOTE_ID_2: [],
        }
        self.rpc_calls = []

    async def create_note(self, *, user_id, access_token, payload):
        del user_id, access_token
        note_id = "55555555-5555-4555-8555-555555555555"
        row = {
            "id": note_id,
            "title": payload["title"],
            "note_body": payload["note_body"],
            "highlight_text": payload.get("highlight_text"),
            "project_id": payload.get("project_id"),
            "citation_id": payload.get("citation_id"),
            "quote_id": payload.get("quote_id"),
            "status": "active",
            "created_at": "2026-02-01T00:00:00+00:00",
            "updated_at": "2026-02-01T00:00:00+00:00",
        }
        self.notes[note_id] = row
        self.note_tag_links[note_id] = []
        self.note_sources[note_id] = []
        self.note_links[note_id] = []
        return deepcopy(row)

    async def list_notes(self, *, user_id, access_token, project_id=None, citation_id=None, quote_id=None, status=None, query=None, limit=50):
        del user_id, access_token, project_id, quote_id, limit
        rows = list(self.notes.values())
        if citation_id:
            rows = [row for row in rows if row["citation_id"] == citation_id]
        if status:
            rows = [row for row in rows if row["status"] == status]
        if query:
            rows = [row for row in rows if query.lower() in row["note_body"].lower()]
        rows.sort(key=lambda row: (row["updated_at"], row["id"]), reverse=True)
        return [deepcopy(row) for row in rows]

    async def list_notes_by_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        return [deepcopy(self.notes[note_id]) for note_id in note_ids if note_id in self.notes]

    async def update_note(self, *, user_id, access_token, note_id, payload):
        del user_id, access_token
        row = self.notes.get(note_id)
        if row is None:
            return None
        row.update(payload)
        return deepcopy(row)

    async def delete_note(self, *, user_id, access_token, note_id):
        del user_id, access_token
        if note_id not in self.notes:
            return []
        del self.notes[note_id]
        return [{"id": note_id}]

    async def list_note_tag_links(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        rows = []
        for note_id in note_ids:
            for tag_id in self.note_tag_links.get(note_id, []):
                rows.append({"note_id": note_id, "tag_id": tag_id, "created_at": "2026-01-01T00:00:00+00:00"})
        return rows

    async def list_note_sources(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        rows = []
        for note_id in note_ids:
            rows.extend(deepcopy(self.note_sources.get(note_id, [])))
        return rows

    async def list_note_links(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        rows = []
        for note_id in note_ids:
            for link in self.note_links.get(note_id, []):
                rows.append({"note_id": note_id, "linked_note_id": link["linked_note_id"], "link_type": link["link_type"], "created_at": "2026-01-01T00:00:00+00:00"})
        return rows

    async def call_replace_rpc(self, *, function_name, payload):
        self.rpc_calls.append((function_name, deepcopy(payload)))
        if function_name == "replace_note_tag_links_atomic":
            self.note_tag_links[payload["p_note_id"]] = list(payload["p_tag_ids"])
            return type("Resp", (), {"status_code": 200})(), payload["p_tag_ids"]
        if function_name == "replace_note_sources_atomic":
            stored_rows = [
                {"id": f"rel-{index}", "note_id": payload["p_note_id"], "relation_type": source.get("target_kind"), "attached_at": f"2026-01-0{index+1}T00:00:00+00:00", **source}
                for index, source in enumerate(payload["p_sources"])
            ]
            self.note_sources[payload["p_note_id"]] = sorted(
                stored_rows,
                key=lambda row: (row.get("position", 0), row.get("attached_at") or "", row.get("id") or ""),
            )
            return type("Resp", (), {"status_code": 200})(), payload["p_sources"]
        if function_name == "replace_note_links_atomic":
            self.note_links[payload["p_note_id"]] = list(payload["p_note_links"])
            return type("Resp", (), {"status_code": 200})(), payload["p_note_links"]
        return type("Resp", (), {"status_code": 422, "json": lambda self: {"message": "invalid"}})(), None


class FakeQuotesRepository:
    def __init__(self):
        self.quotes = {
            QUOTE_ID_1: {"id": QUOTE_ID_1, "citation_id": "citation-a", "excerpt": "Alpha quote", "locator": {"page": 1}, "annotation": None, "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"},
            QUOTE_ID_2: {"id": QUOTE_ID_2, "citation_id": "citation-a", "excerpt": "Beta quote", "locator": {"page": 2}, "annotation": None, "created_at": "2026-01-02T00:00:00+00:00", "updated_at": "2026-01-02T00:00:00+00:00"},
            QUOTE_ID_3: {"id": QUOTE_ID_3, "citation_id": "citation-b", "excerpt": "Gamma quote", "locator": {"page": 3}, "annotation": None, "created_at": "2026-01-01T12:00:00+00:00", "updated_at": "2026-01-01T12:00:00+00:00"},
        }
        self.note_ids_by_quote = {QUOTE_ID_1: [NOTE_ID_1], QUOTE_ID_2: [], QUOTE_ID_3: [NOTE_ID_2]}
        self.list_quotes_calls = []
        self.list_quotes_for_document_calls = []

    async def list_quotes(self, *, user_id, access_token, citation_id=None, citation_ids=None, quote_ids=None, query=None, limit=50, offset=0, order="created_at.desc,id.desc"):
        del user_id, access_token, limit, offset
        self.list_quotes_calls.append(
            {
                "citation_id": citation_id,
                "citation_ids": citation_ids,
                "quote_ids": quote_ids,
                "query": query,
                "order": order,
            }
        )
        rows = list(self.quotes.values())
        if citation_id:
            rows = [row for row in rows if row["citation_id"] == citation_id]
        if citation_ids:
            rows = [row for row in rows if row["citation_id"] in citation_ids]
        if quote_ids is not None:
            rows = [self.quotes[quote_id] for quote_id in quote_ids if quote_id in self.quotes]
        if query:
            rows = [row for row in rows if query.lower() in row["excerpt"].lower()]
        reverse = order.startswith("created_at.desc")
        rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=reverse)
        return [deepcopy(row) for row in rows]

    async def list_note_ids_by_quote_ids(self, *, user_id, access_token, quote_ids):
        del user_id, access_token
        return {quote_id: list(self.note_ids_by_quote.get(quote_id, [])) for quote_id in quote_ids}

    async def list_document_citation_links(self, *, user_id, access_token, document_id):
        del user_id, access_token, document_id
        return [
            {"citation_id": "citation-b", "attached_at": "2026-01-01T00:00:00+00:00"},
            {"citation_id": "citation-a", "attached_at": "2026-01-02T00:00:00+00:00"},
            {"citation_id": "citation-a", "attached_at": "2026-01-02T00:00:00+00:00"},
        ]

    async def list_quotes_for_document(self, *, user_id, access_token, document_id, query=None):
        self.list_quotes_for_document_calls.append({"document_id": document_id, "query": query})
        links = await self.list_document_citation_links(user_id=user_id, access_token=access_token, document_id=document_id)
        citation_ids_in_order = []
        for link in links:
            citation_id = link["citation_id"]
            if citation_id not in citation_ids_in_order:
                citation_ids_in_order.append(citation_id)
        rows = await self.list_quotes(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids_in_order,
            query=query,
            order="created_at.asc,id.asc",
        )
        return citation_ids_in_order, rows

    async def delete_quote(self, *, user_id, access_token, quote_id):
        del user_id, access_token
        if quote_id not in self.quotes:
            return []
        del self.quotes[quote_id]
        return [{"id": quote_id}]


class FakeNotesServiceForQuotes:
    def __init__(self):
        self.calls = []

    async def create_note(self, *, user_id, access_token, payload):
        self.calls.append((user_id, deepcopy(payload)))
        return {"id": "note-from-quote", **payload, "tags": [], "note_links": [], "evidence_links": [], "status": "active", "created_at": "2026-02-01T00:00:00+00:00", "updated_at": "2026-02-01T00:00:00+00:00"}

    async def list_notes_by_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        return [
            {
                "id": NOTE_ID_1,
                "title": "Quote note",
                "note_body": "Body",
                "highlight_text": None,
                "project_id": None,
                "citation_id": "citation-a",
                "quote_id": QUOTE_ID_1,
                "status": "active",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
            for note_id in note_ids
            if note_id == NOTE_ID_1
        ]


class FakeWorkspaceRepository:
    def __init__(self):
        self.revision_counter = 0
        self.documents = {
            DOC_ID: {
                "id": DOC_ID,
                "title": "Draft",
                "content_delta": {"ops": [{"insert": "Heading\n", "attributes": {"header": 1}}, {"insert": "Body\n"}]},
                "content_html": "<h1>Heading</h1><p>Body</p>",
                "project_id": None,
                "status": "active",
                "archived_at": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            }
        }
        self.document_citations = {DOC_ID: ["citation-b", "citation-a"]}
        self.document_notes = {DOC_ID: [NOTE_ID_2, NOTE_ID_1]}
        self.document_tags = {DOC_ID: ["tag-2", "tag-1"]}
        self.checkpoints = {
            CHECKPOINT_ID: {
                "id": CHECKPOINT_ID,
                "document_id": DOC_ID,
                "label": "snap",
                "content_delta": {"ops": [{"insert": "Restored\n"}]},
                "content_html": "<p>Restored</p>",
                "created_at": "2026-01-03T00:00:00+00:00",
            }
        }
        self.rpc_calls = []

    def _next_revision(self):
        self.revision_counter += 1
        return f"2026-01-0{self.revision_counter + 2}T00:00:00+00:00"

    async def list_documents(self, *, user_id, access_token, project_id=None, status=None, limit=50, summary_only=False):
        del user_id, access_token, project_id, limit, summary_only
        rows = list(self.documents.values())
        if status:
            rows = [row for row in rows if row["status"] == status]
        return [deepcopy(row) for row in rows]

    async def list_documents_by_ids(self, *, user_id, access_token, document_ids, summary_only=False):
        del user_id, access_token, summary_only
        return [deepcopy(self.documents[document_id]) for document_id in document_ids if document_id in self.documents]

    async def create_document(self, *, user_id, access_token, payload):
        del user_id, access_token
        row = deepcopy(self.documents[DOC_ID])
        row["id"] = "doc-new"
        row["title"] = payload.get("title") or "Untitled"
        row["project_id"] = payload.get("project_id")
        self.documents["doc-new"] = row
        self.document_citations["doc-new"] = []
        self.document_notes["doc-new"] = []
        self.document_tags["doc-new"] = []
        return deepcopy(row)

    async def update_document(self, *, user_id, access_token, document_id, expected_revision, payload):
        del user_id, access_token
        row = self.documents.get(document_id)
        if row is None:
            return None
        if row["updated_at"] != expected_revision:
            return None
        row.update(payload)
        row["updated_at"] = self._next_revision()
        return deepcopy(row)

    async def delete_document(self, *, user_id, access_token, document_id):
        del user_id, access_token
        if document_id not in self.documents:
            return []
        del self.documents[document_id]
        return [{"id": document_id}]

    async def list_relation_rows(self, *, table, user_id, access_token, document_ids):
        del user_id, access_token
        rows = []
        for document_id in document_ids:
            if table == "document_citations":
                for index, citation_id in enumerate(self.document_citations.get(document_id, [])):
                    rows.append({"document_id": document_id, "citation_id": citation_id, "attached_at": f"2026-01-0{index+1}T00:00:00+00:00"})
            elif table == "document_notes":
                for index, note_id in enumerate(self.document_notes.get(document_id, [])):
                    rows.append({"document_id": document_id, "note_id": note_id, "attached_at": f"2026-01-0{index+1}T00:00:00+00:00"})
            else:
                for index, tag_id in enumerate(self.document_tags.get(document_id, [])):
                    rows.append({"document_id": document_id, "tag_id": tag_id, "created_at": f"2026-01-0{index+1}T00:00:00+00:00"})
        return rows

    async def list_documents_for_citation_ids(self, *, user_id, access_token, citation_ids):
        del user_id, access_token
        rows = []
        for document_id, doc_citation_ids in self.document_citations.items():
            for citation_id in doc_citation_ids:
                if citation_id in citation_ids:
                    rows.append({"document_id": document_id, "citation_id": citation_id, "attached_at": "2026-01-01T00:00:00+00:00"})
        return rows

    async def list_documents_for_note_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        rows = []
        for document_id, doc_note_ids in self.document_notes.items():
            for note_id in doc_note_ids:
                if note_id in note_ids:
                    rows.append({"document_id": document_id, "note_id": note_id, "attached_at": "2026-01-01T00:00:00+00:00"})
        return rows

    async def create_checkpoint(self, *, user_id, access_token, document_id, label, content_delta, content_html):
        del user_id, access_token, content_delta, content_html
        checkpoint = deepcopy(self.checkpoints[CHECKPOINT_ID])
        checkpoint["id"] = "checkpoint-new"
        checkpoint["document_id"] = document_id
        checkpoint["label"] = label
        self.checkpoints["checkpoint-new"] = checkpoint
        return checkpoint

    async def list_checkpoints(self, *, user_id, access_token, document_id, limit=10):
        del user_id, access_token, limit
        return [deepcopy(row) for row in self.checkpoints.values() if row["document_id"] == document_id]

    async def get_checkpoint(self, *, user_id, access_token, document_id, checkpoint_id):
        del user_id, access_token, document_id
        row = self.checkpoints.get(checkpoint_id)
        return deepcopy(row) if row else None

    async def call_replace_rpc(self, *, function_name, payload):
        self.rpc_calls.append((function_name, deepcopy(payload)))
        document_id = payload.get("p_document_id")
        if document_id in self.documents and payload.get("p_expected_revision") != self.documents[document_id]["updated_at"]:
            return type("Resp", (), {"status_code": 409})(), None
        if function_name == "replace_document_citations_atomic":
            self.document_citations[payload["p_document_id"]] = list(payload["p_citation_ids"])
            self.documents[payload["p_document_id"]]["updated_at"] = self._next_revision()
        elif function_name == "replace_document_notes_atomic":
            self.document_notes[payload["p_document_id"]] = list(payload["p_note_ids"])
            self.documents[payload["p_document_id"]]["updated_at"] = self._next_revision()
        elif function_name == "replace_document_tags_atomic":
            self.document_tags[payload["p_document_id"]] = list(payload["p_tag_ids"])
            self.documents[payload["p_document_id"]]["updated_at"] = self._next_revision()
        return type("Resp", (), {"status_code": 200})(), True


class FakeNotesServiceForWorkspace:
    def __init__(self, notes_repository):
        self.notes_repository = notes_repository

    async def list_notes_by_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        rows = []
        for note_id in note_ids:
            note = self.notes_repository.notes[note_id]
            tag_ids = self.notes_repository.note_tag_links.get(note_id, [])
            rows.append(
                {
                    "id": note["id"],
                    "title": note["title"],
                    "note_body": note["note_body"],
                    "highlight_text": note["highlight_text"],
                    "project_id": note["project_id"],
                    "citation_id": note["citation_id"],
                    "quote_id": note["quote_id"],
                    "tags": [
                        {"id": tag_id, "name": "evidence" if tag_id == "tag-1" else "draft", "normalized_name": "evidence" if tag_id == "tag-1" else "draft"}
                        for tag_id in tag_ids
                    ],
                    "note_links": deepcopy(self.notes_repository.note_links.get(note_id, [])),
                    "evidence_links": [
                        {
                            **source,
                            "target_kind": source.get("relation_type"),
                        }
                        for source in deepcopy(self.notes_repository.note_sources.get(note_id, []))
                    ],
                    "lineage": {
                        "citation_id": note["citation_id"],
                        "quote_id": note["quote_id"],
                        "evidence_source_ids": [source.get("source_id") for source in self.notes_repository.note_sources.get(note_id, []) if source.get("source_id")],
                        "evidence_citation_ids": [source.get("citation_id") for source in self.notes_repository.note_sources.get(note_id, []) if source.get("citation_id")],
                    },
                    "status": note["status"],
                    "created_at": note["created_at"],
                    "updated_at": note["updated_at"],
                }
            )
        return rows


@pytest.fixture
def notes_service():
    repository = FakeNotesRepository()
    ownership = FakeOwnership(notes=repository.notes, quotes={QUOTE_ID_1: {"id": QUOTE_ID_1, "citation_id": "citation-a"}})
    citations_service = FakeCitationsService()
    citations_service.repository.list_citations = citations_service.list_citations_repo_passthrough
    return NotesService(
        repository=repository,
        sources_service=FakeSourcesService(),
        taxonomy_service=FakeTaxonomyService(),
        citations_service=citations_service,
        workspace_service=None,
        ownership=ownership,
        relation_validation=FakeRelationValidation(valid_notes=repository.notes.keys()),
    )


@pytest.fixture
def quotes_service():
    notes_service = FakeNotesServiceForQuotes()
    ownership = FakeOwnership(quotes={QUOTE_ID_1: {"id": QUOTE_ID_1, "citation_id": "citation-a", "excerpt": "Alpha quote", "locator": {"page": 1}, "annotation": None, "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}})
    return QuotesService(
        repository=FakeQuotesRepository(),
        citations_service=FakeCitationsService(),
        notes_service=notes_service,
        workspace_repository=FakeWorkspaceRepository(),
        ownership=ownership,
        relation_validation=FakeRelationValidation(),
    )


@pytest.fixture
def workspace_service():
    notes_repository = FakeNotesRepository()
    repository = FakeWorkspaceRepository()
    ownership = FakeOwnership(documents=repository.documents)
    citations_service = FakeCitationsService()
    return WorkspaceService(
        repository=repository,
        taxonomy_service=FakeTaxonomyService(),
        sources_service=FakeSourcesService(),
        citations_service=citations_service,
        quotes_service=FakeQuotesServiceForWorkspace(),
        notes_service=FakeNotesServiceForWorkspace(notes_repository),
        ownership=ownership,
        relation_validation=FakeRelationValidation(valid_notes=notes_repository.notes.keys()),
    )


class FakeQuotesServiceForWorkspace:
    async def list_quotes(self, *, user_id, access_token, document_id=None, limit=50, **kwargs):
        del user_id, access_token, limit, kwargs
        if document_id != DOC_ID:
            return []
        return [
            {"id": QUOTE_ID_3, "citation": {"id": "citation-b", "source": {"id": "source-b"}}},
            {"id": QUOTE_ID_1, "citation": {"id": "citation-a", "source": {"id": "source-a"}}},
        ]


@pytest.mark.anyio
async def test_quotes_list_by_document_is_deduped_and_ordered(quotes_service):
    rows = await quotes_service.list_quotes(user_id="user-1", access_token=None, document_id=DOC_ID, limit=10)
    assert [row["id"] for row in rows] == [QUOTE_ID_3, QUOTE_ID_1, QUOTE_ID_2]
    assert rows[0]["citation"]["id"] == "citation-b"
    assert quotes_service.repository.list_quotes_for_document_calls[-1] == {"document_id": DOC_ID, "query": None}


@pytest.mark.anyio
async def test_quote_query_prefilters_in_repo_before_hydration(quotes_service):
    rows = await quotes_service.list_quotes(user_id="user-1", access_token=None, query="Alpha", limit=10)
    assert [row["id"] for row in rows] == [QUOTE_ID_1]
    assert quotes_service.repository.list_quotes_calls[-1]["query"] == "Alpha"


@pytest.mark.anyio
async def test_quote_to_note_preserves_quote_and_citation(quotes_service):
    note = await quotes_service.create_note_from_quote(
        user_id="user-1",
        access_token=None,
        quote_id=QUOTE_ID_1,
        payload={"title": "From quote", "note_body": "Body", "project_id": None, "tag_ids": ["tag-1"]},
    )
    assert note["quote_id"] == QUOTE_ID_1
    assert note["citation_id"] == "citation-a"
    assert note["highlight_text"] == "Alpha quote"


@pytest.mark.anyio
async def test_quote_to_note_requires_owned_quote(quotes_service):
    with pytest.raises(HTTPException) as exc:
        await quotes_service.create_note_from_quote(
            user_id="user-1",
            access_token=None,
            quote_id=QUOTE_ID_2,
            payload={"title": "From quote", "note_body": "Body", "project_id": None, "tag_ids": []},
        )
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_note_replace_tags_uses_atomic_rpc_and_returns_hydrated_entity(notes_service):
    result = await notes_service.replace_note_tags(user_id="user-1", access_token=None, note_id=NOTE_ID_1, tag_ids=["tag-2", "tag-2"])
    assert result["tags"] == [{"id": "tag-2", "name": "draft", "normalized_name": "draft"}]
    assert notes_service.repository.rpc_calls[-1][0] == "replace_note_tag_links_atomic"
    assert notes_service.repository.rpc_calls[-1][1]["p_tag_ids"] == ["tag-2"]
    assert ("note", NOTE_ID_1) in notes_service.ownership.calls


@pytest.mark.anyio
async def test_note_replace_tags_rejects_invalid_unowned_tags_before_mutation(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_tags(user_id="user-1", access_token=None, note_id=NOTE_ID_1, tag_ids=["foreign-tag"])
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_document_relation_replacement_is_atomic_and_document_payload_is_canonical(workspace_service):
    capability_state = DummyCapabilityState()
    result = await workspace_service.replace_document_citations(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        revision=workspace_service.repository.documents[DOC_ID]["updated_at"],
        citation_ids=["citation-a", "citation-a", "citation-b"],
    )
    assert result["data"]["attached_citation_ids"] == ["citation-a", "citation-b"]
    assert "citation_ids" not in result["data"]
    assert result["data"]["revision"] == workspace_service.repository.documents[DOC_ID]["updated_at"]
    assert workspace_service.repository.rpc_calls[-1][0] == "replace_document_citations_atomic"
    assert workspace_service.repository.rpc_calls[-1][1]["p_citation_ids"] == ["citation-a", "citation-b"]
    assert workspace_service.repository.rpc_calls[-1][1]["p_expected_revision"] == "2026-01-02T00:00:00+00:00"
    assert ("document", DOC_ID) in workspace_service.ownership.calls


@pytest.mark.anyio
async def test_checkpoint_restore_restores_content_only(workspace_service):
    capability_state = DummyCapabilityState()
    workspace_service.repository.documents[DOC_ID]["title"] = "Keep title"
    restored = await workspace_service.restore_checkpoint(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        checkpoint_id=CHECKPOINT_ID,
        revision=workspace_service.repository.documents[DOC_ID]["updated_at"],
    )
    assert restored["data"]["title"] == "Keep title"
    assert restored["data"]["content_html"] == "<p>Restored</p>"
    assert ("document", DOC_ID) in workspace_service.ownership.calls


@pytest.mark.anyio
async def test_document_hydration_preserves_relation_order(workspace_service):
    capability_state = DummyCapabilityState()
    payload = await workspace_service.hydrate_document(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        seed={"document_id": DOC_ID, "citation_id": "citation-a", "quote_id": QUOTE_ID_1, "mode": "seed_review"},
    )
    assert [item["id"] for item in payload["data"]["attached_citations"]] == ["citation-b", "citation-a"]
    assert [item["id"] for item in payload["data"]["attached_notes"]] == [NOTE_ID_2, NOTE_ID_1]
    assert [item["id"] for item in payload["data"]["attached_quotes"]] == [QUOTE_ID_3, QUOTE_ID_1]
    assert [item["id"] for item in payload["data"]["derived_sources"]] == ["source-b", "source-a"]
    assert payload["data"]["attached_notes"][1]["evidence_links"][0]["source_id"] == "source-a"
    assert payload["data"]["attached_notes"][1]["evidence_links"][0]["citation_id"] == "citation-a"
    assert payload["data"]["attached_notes"][1]["tags"][0]["id"] == "tag-1"
    assert payload["data"]["attached_notes"][1]["lineage"]["evidence_source_ids"] == ["source-a"]
    assert payload["data"]["document"]["project"] is None
    assert payload["data"]["seed"]["citation_id"] == "citation-a"
    assert payload["data"]["seed"]["quote_id"] == QUOTE_ID_1


@pytest.mark.anyio
async def test_document_create_accepts_project_assignment(workspace_service):
    capability_state = DummyCapabilityState()
    payload = await workspace_service.create_document(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        payload={"title": "Project draft", "project_id": "project-1"},
    )
    assert payload["data"]["project_id"] == "project-1"


@pytest.mark.anyio
async def test_note_create_preserves_quote_citation_lineage(notes_service):
    note = await notes_service.create_note(
        user_id="user-1",
        access_token=None,
        payload={
            "title": "Lineage note",
            "note_body": "Body",
            "quote_id": QUOTE_ID_1,
            "citation_id": None,
            "tag_ids": [],
            "evidence_links": [],
            "note_links": [],
        },
    )
    assert note["quote_id"] == QUOTE_ID_1
    assert note["citation_id"] == "citation-a"


@pytest.mark.anyio
async def test_note_create_accepts_project_assignment(notes_service):
    note = await notes_service.create_note(
        user_id="user-1",
        access_token=None,
        payload={
            "title": "Project note",
            "note_body": "Body",
            "project_id": "project-1",
            "tag_ids": [],
            "evidence_links": [],
            "note_links": [],
        },
    )
    assert note["project_id"] == "project-1"


@pytest.mark.anyio
async def test_note_create_rejects_mismatched_quote_and_citation(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.create_note(
            user_id="user-1",
            access_token=None,
            payload={
                "title": "Lineage mismatch",
                "note_body": "Body",
                "quote_id": QUOTE_ID_1,
                "citation_id": "citation-b",
                "tag_ids": [],
                "evidence_links": [],
                "note_links": [],
            },
        )
    assert exc.value.status_code == 422


@pytest.mark.anyio
async def test_note_detail_returns_grouped_relationships(notes_service, workspace_service):
    notes_service.workspace_service = workspace_service
    note = await notes_service.get_note(
        user_id="user-1",
        access_token=None,
        note_id=NOTE_ID_1,
    )
    assert note["project"] is None
    assert note["lineage"]["citation"]["id"] == "citation-a"
    assert note["relationship_groups"]["evidence_links_by_role"]["supporting"][0]["source_id"] == "source-a"
    assert note["relationship_groups"]["note_links_by_type"]["related"][0]["note"]["id"] == NOTE_ID_2
    assert note["attached_documents"][0]["id"] == DOC_ID


@pytest.mark.anyio
async def test_note_update_moves_to_project(notes_service):
    note = await notes_service.update_note(
        user_id="user-1",
        access_token=None,
        note_id=NOTE_ID_1,
        payload={"project_id": "project-1"},
    )
    assert note["project_id"] == "project-1"


@pytest.mark.anyio
async def test_outline_is_derived_read_only_best_effort(workspace_service):
    payload = await workspace_service.outline_document(user_id="user-1", access_token=None, document_id=DOC_ID)
    assert payload["data"]["items"] == [{"level": 1, "text": "Heading", "anchor": "heading"}]


@pytest.mark.anyio
async def test_replace_note_sources_rejects_unowned_source_id_before_rpc(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_sources(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            evidence_links=[{"target_kind": "source", "evidence_role": "supporting", "source_id": "source-foreign"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_replace_note_sources_roundtrips_canonical_provenance(notes_service):
    result = await notes_service.replace_note_sources(
        user_id="user-1",
        access_token=None,
        note_id=NOTE_ID_1,
        evidence_links=[
            {
                "target_kind": "source",
                "evidence_role": "background",
                "source_id": "source-a",
                "url": "https://example.com/source",
                "title": "Source provenance",
                "position": 3,
            },
            {
                "target_kind": "citation",
                "evidence_role": "primary",
                "citation_id": "citation-a",
                "source_id": "source-a",
                "url": "https://example.com/citation",
                "title": "Citation provenance",
            },
        ],
    )

    stored = result["evidence_links"]
    assert [item["target_kind"] for item in stored] == ["citation", "source"]
    assert [item["evidence_role"] for item in stored] == ["primary", "background"]
    assert stored[0]["citation_id"] == "citation-a"
    assert stored[0]["source_id"] == "source-a"
    assert stored[0]["position"] == 1
    assert stored[1]["source_id"] == "source-a"
    assert stored[1]["citation_id"] is None
    assert stored[1]["position"] == 3
    assert result["lineage"]["citation_id"] == "citation-a"
    assert result["lineage"]["quote_id"] is None
    assert result["lineage"]["citation"]["id"] == "citation-a"
    assert result["lineage"]["quote"] is None
    assert result["lineage"]["evidence_source_ids"] == ["source-a", "source-a"]
    assert result["lineage"]["evidence_citation_ids"] == ["citation-a"]
    assert notes_service.repository.rpc_calls[-1][0] == "replace_note_sources_atomic"
    assert notes_service.repository.rpc_calls[-1][1]["p_sources"][0]["position"] == 3
    assert notes_service.repository.rpc_calls[-1][1]["p_sources"][1]["position"] == 1
    assert notes_service.repository.rpc_calls[-1][1]["p_sources"][0]["evidence_role"] == "background"


@pytest.mark.anyio
async def test_replace_note_sources_rejects_unowned_citation_id_before_rpc(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_sources(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            evidence_links=[{"target_kind": "citation", "evidence_role": "supporting", "citation_id": "citation-foreign"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_replace_note_sources_rejects_malformed_provenance_rows(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_sources(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            evidence_links=[{"target_kind": "citation", "evidence_role": "supporting"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_replace_note_sources_rejects_invalid_evidence_role(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_sources(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            evidence_links=[{"target_kind": "source", "evidence_role": "invalid", "source_id": "source-a"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_replace_note_links_roundtrips_structured_types(notes_service):
    result = await notes_service.replace_note_links(
        user_id="user-1",
        access_token=None,
        note_id=NOTE_ID_1,
        note_links=[
            {"linked_note_id": NOTE_ID_2, "link_type": "supports"},
            {"linked_note_id": NOTE_ID_2, "link_type": "supports"},
        ],
    )
    assert result["note_links"] == [{"linked_note_id": NOTE_ID_2, "link_type": "supports", "created_at": "2026-01-01T00:00:00+00:00"}]
    assert notes_service.repository.rpc_calls[-1][0] == "replace_note_links_atomic"
    assert notes_service.repository.rpc_calls[-1][1]["p_note_links"] == [{"linked_note_id": NOTE_ID_2, "link_type": "supports"}]


@pytest.mark.anyio
async def test_replace_note_links_rejects_invalid_link_type(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_links(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            note_links=[{"linked_note_id": NOTE_ID_2, "link_type": "invalid"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_replace_note_links_rejects_unowned_note_before_rpc(notes_service):
    with pytest.raises(HTTPException) as exc:
        await notes_service.replace_note_links(
            user_id="user-1",
            access_token=None,
            note_id=NOTE_ID_1,
            note_links=[{"linked_note_id": "note-foreign", "link_type": "supports"}],
        )
    assert exc.value.status_code == 422
    assert notes_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_quote_delete_preloads_parent_before_delete(quotes_service):
    result = await quotes_service.delete_quote(user_id="user-1", access_token=None, quote_id=QUOTE_ID_1)
    assert result["id"] == QUOTE_ID_1
    assert ("quote", QUOTE_ID_1) in quotes_service.ownership.calls


@pytest.mark.anyio
async def test_note_delete_preloads_parent_before_delete(notes_service):
    result = await notes_service.delete_note(user_id="user-1", access_token=None, note_id=NOTE_ID_1)
    assert result["id"] == NOTE_ID_1
    assert ("note", NOTE_ID_1) in notes_service.ownership.calls


@pytest.mark.anyio
async def test_quote_detail_exposes_canonical_neighborhood(quotes_service):
    payload = await quotes_service.get_quote(user_id="user-1", access_token=None, quote_id=QUOTE_ID_1)
    assert payload["neighborhood"]["citation"]["id"] == "citation-a"
    assert payload["neighborhood"]["notes"][0]["id"] == NOTE_ID_1
    assert payload["neighborhood"]["documents"][0]["id"] == DOC_ID


@pytest.mark.anyio
async def test_document_delete_preloads_parent_before_delete(workspace_service):
    result = await workspace_service.delete_document(user_id="user-1", access_token=None, document_id=DOC_ID)
    assert result["data"]["id"] == DOC_ID
    assert ("document", DOC_ID) in workspace_service.ownership.calls


@pytest.mark.anyio
async def test_replace_document_notes_preloads_parent_and_single_rpc(workspace_service):
    capability_state = DummyCapabilityState()
    result = await workspace_service.replace_document_notes(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        revision=workspace_service.repository.documents[DOC_ID]["updated_at"],
        note_ids=[NOTE_ID_2, NOTE_ID_1, NOTE_ID_1],
    )
    assert result["data"]["attached_note_ids"] == [NOTE_ID_2, NOTE_ID_1]
    assert workspace_service.repository.rpc_calls[-1][0] == "replace_document_notes_atomic"
    assert workspace_service.repository.rpc_calls[-1][1]["p_expected_revision"] == "2026-01-02T00:00:00+00:00"
    assert workspace_service.repository.rpc_calls[-1][1]["p_note_ids"] == [NOTE_ID_2, NOTE_ID_1]
    assert ("document", DOC_ID) in workspace_service.ownership.calls


@pytest.mark.anyio
async def test_replace_document_tags_preloads_parent_and_single_rpc(workspace_service):
    capability_state = DummyCapabilityState()
    result = await workspace_service.replace_document_tags(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        revision=workspace_service.repository.documents[DOC_ID]["updated_at"],
        tag_ids=["tag-2", "tag-2"],
    )
    assert result["data"]["tag_ids"] == ["tag-2"]
    assert workspace_service.repository.rpc_calls[-1][0] == "replace_document_tags_atomic"
    assert workspace_service.repository.rpc_calls[-1][1]["p_expected_revision"] == "2026-01-02T00:00:00+00:00"
    assert workspace_service.repository.rpc_calls[-1][1]["p_tag_ids"] == ["tag-2"]
    assert ("document", DOC_ID) in workspace_service.ownership.calls


@pytest.mark.anyio
async def test_document_update_rejects_stale_revision_before_mutation(workspace_service):
    capability_state = DummyCapabilityState()
    with pytest.raises(HTTPException) as exc:
        await workspace_service.update_document(
            user_id="user-1",
            access_token=None,
            capability_state=capability_state,
            document_id=DOC_ID,
            payload={"revision": "2026-01-01T00:00:00+00:00", "title": "Stale title"},
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "revision_conflict"


@pytest.mark.anyio
async def test_document_attachment_rejects_stale_revision_before_rpc(workspace_service):
    capability_state = DummyCapabilityState()
    with pytest.raises(HTTPException) as exc:
        await workspace_service.replace_document_notes(
            user_id="user-1",
            access_token=None,
            capability_state=capability_state,
            document_id=DOC_ID,
            revision="2026-01-01T00:00:00+00:00",
            note_ids=[NOTE_ID_1],
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "revision_conflict"
    assert workspace_service.repository.rpc_calls == []


@pytest.mark.anyio
async def test_document_mutation_advances_revision(workspace_service):
    capability_state = DummyCapabilityState()
    before = workspace_service.repository.documents[DOC_ID]["updated_at"]
    result = await workspace_service.update_document(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        payload={
            "revision": before,
            "title": "Updated title",
            "content_delta": workspace_service.repository.documents[DOC_ID]["content_delta"],
            "content_html": workspace_service.repository.documents[DOC_ID]["content_html"],
            "project_id": None,
        },
    )
    assert result["data"]["revision"] != before
    assert workspace_service.repository.documents[DOC_ID]["updated_at"] == result["data"]["revision"]


@pytest.mark.anyio
async def test_document_update_moves_to_project(workspace_service):
    capability_state = DummyCapabilityState()
    before = workspace_service.repository.documents[DOC_ID]["updated_at"]
    result = await workspace_service.update_document(
        user_id="user-1",
        access_token=None,
        capability_state=capability_state,
        document_id=DOC_ID,
        payload={
            "revision": before,
            "project_id": "project-1",
        },
    )
    assert result["data"]["project_id"] == "project-1"
