from __future__ import annotations

from copy import deepcopy

import pytest

from app.modules.extension.schemas import WorkInEditorRequest
from app.modules.research.graph_service import ResearchGraphService
from app.modules.workspace.service import WorkspaceService


SOURCE_ID = "11111111-1111-4111-8111-111111111111"
CITATION_ID = "22222222-2222-4222-8222-222222222222"
QUOTE_ID = "33333333-3333-4333-8333-333333333333"
NOTE_ID = "44444444-4444-4444-8444-444444444444"
LINKED_NOTE_ID = "55555555-5555-4555-8555-555555555555"
DOCUMENT_ID = "66666666-6666-4666-8666-666666666666"


class DummyCapabilityState:
    tier = "pro"
    capabilities = {"documents": {"freeze": False}, "exports": ["html", "pdf"]}


class FakeSourcesService:
    def __init__(self):
        self.rows = {
            SOURCE_ID: {
                "id": SOURCE_ID,
                "title": "Source A",
                "source_type": "webpage",
                "authors": [],
                "container_title": None,
                "publisher": None,
                "issued_date": {},
                "identifiers": {},
                "canonical_url": "https://example.com/source",
                "page_url": "https://example.com/source",
                "hostname": "example.com",
                "language_code": "en",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            }
        }

    async def get_source(self, *, user_id, access_token, source_id):
        del user_id, access_token
        return deepcopy(self.rows[source_id])

    async def list_sources_by_ids(self, *, user_id, access_token, source_ids):
        del user_id, access_token
        return [deepcopy(self.rows[source_id]) for source_id in source_ids if source_id in self.rows]


class FakeCitationsService:
    def __init__(self):
        self.sources_service = FakeSourcesService()
        self.rows = {
            CITATION_ID: {
                "id": CITATION_ID,
                "source_id": SOURCE_ID,
                "source": deepcopy(self.sources_service.rows[SOURCE_ID]),
                "locator": {"paragraph": 3},
                "annotation": "ctx",
                "excerpt": "Quoted context",
                "quote_text": "Quoted context",
                "renders": {"mla": {"bibliography": "Source A."}},
                "relationship_counts": {"quote_count": 1, "note_count": 1, "document_count": 1},
                "created_at": "2026-01-03T00:00:00+00:00",
                "updated_at": "2026-01-04T00:00:00+00:00",
            }
        }
        self.create_calls = []

    async def get_citation(self, *, user_id, access_token, citation_id, account_type=None):
        del user_id, access_token, account_type
        return deepcopy(self.rows[citation_id])

    async def list_citations(self, *, user_id, access_token, ids=None, source_id=None, limit=50, account_type=None, **kwargs):
        del user_id, access_token, limit, account_type, kwargs
        rows = list(self.rows.values())
        if ids is not None:
            rows = [row for row in rows if row["id"] in ids]
        if source_id:
            rows = [row for row in rows if row["source_id"] == source_id]
        return [deepcopy(row) for row in rows]

    async def create_citation(
        self,
        *,
        user_id,
        access_token,
        account_type,
        extraction_payload,
        excerpt,
        locator,
        annotation,
        quote,
        style,
    ):
        del access_token, account_type
        self.create_calls.append(
            {
                "user_id": user_id,
                "extraction_payload": deepcopy(extraction_payload),
                "excerpt": excerpt,
                "locator": deepcopy(locator),
                "annotation": annotation,
                "quote": quote,
                "style": style,
            }
        )
        row = deepcopy(self.rows[CITATION_ID])
        row["excerpt"] = excerpt
        row["quote_text"] = quote
        row["locator"] = locator or {}
        self.rows[row["id"]] = row
        return row


class FakeQuotesService:
    def __init__(self):
        self.rows = {
            QUOTE_ID: {
                "id": QUOTE_ID,
                "excerpt": "Quoted context",
                "locator": {"paragraph": 3},
                "annotation": None,
                "citation": {"id": CITATION_ID, "source": {"id": SOURCE_ID}},
                "created_at": "2026-01-03T00:00:00+00:00",
                "updated_at": "2026-01-03T00:00:00+00:00",
                "note_ids": [NOTE_ID],
            }
        }
        self.create_calls = []

    async def get_quote(self, *, user_id, access_token, quote_id):
        del user_id, access_token
        return deepcopy(self.rows[quote_id])

    async def list_quotes(self, *, user_id, access_token, citation_id=None, quote_ids=None, limit=50, **kwargs):
        del user_id, access_token, limit, kwargs
        rows = list(self.rows.values())
        if citation_id:
            rows = [row for row in rows if row["citation"]["id"] == citation_id]
        if quote_ids is not None:
            rows = [row for row in rows if row["id"] in quote_ids]
        return [deepcopy(row) for row in rows]

    async def list_quotes_by_ids(self, *, user_id, access_token, quote_ids):
        return await self.list_quotes(user_id=user_id, access_token=access_token, quote_ids=quote_ids)

    async def create_quote(self, *, user_id, access_token, payload):
        del user_id, access_token
        self.create_calls.append(deepcopy(payload))
        row = deepcopy(self.rows[QUOTE_ID])
        row["citation"] = {"id": payload["citation_id"], "source": {"id": SOURCE_ID}}
        row["excerpt"] = payload["excerpt"]
        row["locator"] = payload.get("locator") or {}
        self.rows[row["id"]] = row
        return row


class FakeNotesService:
    def __init__(self):
        self.rows = {
            NOTE_ID: {
                "id": NOTE_ID,
                "title": "Primary note",
                "note_body": "Synthesis",
                "highlight_text": "Quoted context",
                "project_id": None,
                "citation_id": CITATION_ID,
                "quote_id": QUOTE_ID,
                "tags": [{"id": "tag-1", "name": "evidence", "normalized_name": "evidence"}],
                "linked_note_ids": [LINKED_NOTE_ID],
                "sources": [
                    {
                        "id": "rel-1",
                        "source_id": SOURCE_ID,
                        "citation_id": CITATION_ID,
                        "relation_type": "citation",
                        "url": "https://example.com/source",
                        "hostname": "example.com",
                        "title": "Source A",
                        "display": {"label": "Source A", "subtitle": "example.com"},
                        "attached_at": "2026-01-04T00:00:00+00:00",
                        "position": 0,
                    }
                ],
                "lineage": {
                    "citation_id": CITATION_ID,
                    "quote_id": QUOTE_ID,
                    "supporting_source_ids": [SOURCE_ID],
                    "supporting_citation_ids": [CITATION_ID],
                },
                "status": "active",
                "created_at": "2026-01-04T00:00:00+00:00",
                "updated_at": "2026-01-05T00:00:00+00:00",
            },
            LINKED_NOTE_ID: {
                "id": LINKED_NOTE_ID,
                "title": "Linked note",
                "note_body": "Related",
                "highlight_text": None,
                "project_id": None,
                "citation_id": None,
                "quote_id": None,
                "tags": [],
                "linked_note_ids": [],
                "sources": [],
                "lineage": {
                    "citation_id": None,
                    "quote_id": None,
                    "supporting_source_ids": [],
                    "supporting_citation_ids": [],
                },
                "status": "active",
                "created_at": "2026-01-05T00:00:00+00:00",
                "updated_at": "2026-01-05T00:00:00+00:00",
            },
        }
        self.create_calls = []

    async def get_note(self, *, user_id, access_token, note_id):
        del user_id, access_token
        return deepcopy(self.rows[note_id])

    async def list_notes(self, *, user_id, access_token, citation_id=None, quote_id=None, limit=50, **kwargs):
        del user_id, access_token, limit, kwargs
        rows = list(self.rows.values())
        if citation_id:
            rows = [row for row in rows if row.get("citation_id") == citation_id]
        if quote_id:
            rows = [row for row in rows if row.get("quote_id") == quote_id]
        return [deepcopy(row) for row in rows]

    async def list_notes_by_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        return [deepcopy(self.rows[note_id]) for note_id in note_ids if note_id in self.rows]

    async def create_note(self, *, user_id, access_token, payload):
        del user_id, access_token
        self.create_calls.append(deepcopy(payload))
        row = deepcopy(self.rows[NOTE_ID])
        row["title"] = payload["title"]
        row["note_body"] = payload["note_body"]
        row["citation_id"] = payload["citation_id"]
        row["quote_id"] = payload["quote_id"]
        row["sources"] = deepcopy(payload["sources"])
        row["lineage"] = {
            "citation_id": payload["citation_id"],
            "quote_id": payload["quote_id"],
            "supporting_source_ids": [source.get("source_id") for source in payload["sources"] if source.get("source_id")],
            "supporting_citation_ids": [source.get("citation_id") for source in payload["sources"] if source.get("citation_id")],
        }
        self.rows[row["id"]] = row
        return row

    async def list_note_sources_by_citation_ids(self, *, user_id, access_token, citation_ids):
        del user_id, access_token
        if CITATION_ID not in citation_ids:
            return []
        return [
            {
                "id": "rel-1",
                "note_id": NOTE_ID,
                "source_id": SOURCE_ID,
                "citation_id": CITATION_ID,
                "relation_type": "citation",
                "url": "https://example.com/source",
                "position": 0,
            }
        ]

    async def list_note_sources_by_source_ids(self, *, user_id, access_token, source_ids):
        return await self.list_note_sources_by_citation_ids(user_id=user_id, access_token=access_token, citation_ids=[CITATION_ID] if SOURCE_ID in source_ids else [])


class FakeNotesRepository:
    async def list_note_sources_by_citation_ids(self, *, user_id, access_token, citation_ids):
        del user_id, access_token
        if CITATION_ID not in citation_ids:
            return []
        return [
            {
                "id": "rel-1",
                "note_id": NOTE_ID,
                "source_id": SOURCE_ID,
                "citation_id": CITATION_ID,
                "relation_type": "citation",
                "url": "https://example.com/source",
                "position": 0,
            }
        ]

    async def list_note_sources_by_source_ids(self, *, user_id, access_token, source_ids):
        return await self.list_note_sources_by_citation_ids(user_id=user_id, access_token=access_token, citation_ids=[CITATION_ID] if SOURCE_ID in source_ids else [])


class FakeWorkspaceRepository:
    def __init__(self):
        self.document_citation_links = [{"document_id": DOCUMENT_ID, "citation_id": CITATION_ID}]
        self.document_note_links = [{"document_id": DOCUMENT_ID, "note_id": NOTE_ID}]

    async def list_documents_for_citation_ids(self, *, user_id, access_token, citation_ids):
        del user_id, access_token
        return [deepcopy(row) for row in self.document_citation_links if row["citation_id"] in citation_ids]

    async def list_documents_for_note_ids(self, *, user_id, access_token, note_ids):
        del user_id, access_token
        return [deepcopy(row) for row in self.document_note_links if row["note_id"] in note_ids]


class FakeWorkspaceService:
    def __init__(self):
        self.repository = FakeWorkspaceRepository()
        self.document = {
            "id": DOCUMENT_ID,
            "title": "Draft",
            "content_delta": {"ops": [{"insert": "Draft\n"}]},
            "content_html": "<p>Draft</p>",
            "project_id": None,
            "attached_citation_ids": [CITATION_ID],
            "attached_note_ids": [NOTE_ID],
            "tag_ids": [],
            "tags": [],
            "status": "active",
            "archived": False,
            "created_at": "2026-01-06T00:00:00+00:00",
            "updated_at": "2026-01-06T00:00:00+00:00",
            "revision": "2026-01-06T00:00:00+00:00",
        }
        self.create_calls = []
        self.update_calls = []
        self.replace_citation_calls = []
        self.replace_note_calls = []

    async def hydrate_document(self, *, user_id, access_token, capability_state, document_id, seed):
        del user_id, access_token, capability_state, document_id, seed
        return {
            "data": {
                "document": deepcopy(self.document),
                "attached_citations": [deepcopy(FakeCitationsService().rows[CITATION_ID])],
                "attached_quotes": [deepcopy(FakeQuotesService().rows[QUOTE_ID])],
                "attached_notes": [deepcopy(FakeNotesService().rows[NOTE_ID])],
                "attached_sources": [deepcopy(FakeSourcesService().rows[SOURCE_ID])],
                "seed": None,
            }
        }

    async def list_documents_by_ids(self, *, user_id, access_token, capability_state, document_ids):
        del user_id, access_token, capability_state
        return [deepcopy(self.document) for document_id in document_ids if document_id == DOCUMENT_ID]

    async def list_documents_for_citation_ids(self, *, user_id, access_token, citation_ids):
        return await self.repository.list_documents_for_citation_ids(user_id=user_id, access_token=access_token, citation_ids=citation_ids)

    async def list_documents_for_note_ids(self, *, user_id, access_token, note_ids):
        return await self.repository.list_documents_for_note_ids(user_id=user_id, access_token=access_token, note_ids=note_ids)

    async def create_document(self, *, user_id, access_token, capability_state, payload):
        del user_id, access_token, capability_state
        self.create_calls.append(deepcopy(payload))
        return {"data": deepcopy(self.document)}

    async def update_document(self, *, user_id, access_token, capability_state, document_id, payload):
        del user_id, access_token, capability_state, document_id
        self.update_calls.append(deepcopy(payload))
        next_document = deepcopy(self.document)
        next_document["revision"] = "2026-01-06T00:01:00+00:00"
        next_document["updated_at"] = "2026-01-06T00:01:00+00:00"
        return {"data": next_document}

    async def replace_document_citations(self, *, user_id, access_token, capability_state, document_id, revision, citation_ids):
        del user_id, access_token, capability_state, document_id, revision
        self.replace_citation_calls.append(list(citation_ids))
        payload = deepcopy(self.document)
        payload["attached_citation_ids"] = list(citation_ids)
        payload["revision"] = "2026-01-06T00:02:00+00:00"
        payload["updated_at"] = "2026-01-06T00:02:00+00:00"
        return {"data": payload}

    async def replace_document_notes(self, *, user_id, access_token, capability_state, document_id, revision, note_ids):
        del user_id, access_token, capability_state, document_id, revision
        self.replace_note_calls.append(list(note_ids))
        payload = deepcopy(self.document)
        payload["attached_note_ids"] = list(note_ids)
        payload["revision"] = "2026-01-06T00:03:00+00:00"
        payload["updated_at"] = "2026-01-06T00:03:00+00:00"
        return {"data": payload}

    @staticmethod
    def summarize_seed(seed: dict | None) -> dict | None:
        return WorkspaceService.summarize_seed(seed)


@pytest.fixture
def graph_service():
    return ResearchGraphService(
        sources_service=FakeSourcesService(),
        citations_service=FakeCitationsService(),
        quotes_service=FakeQuotesService(),
        notes_service=FakeNotesService(),
        workspace_service=FakeWorkspaceService(),
        notes_repository=FakeNotesRepository(),
    )


@pytest.mark.anyio
async def test_citation_graph_returns_normalized_adjacency(graph_service):
    payload = await graph_service.get_graph(
        user_id="user-1",
        access_token=None,
        capability_state=DummyCapabilityState(),
        entity="citation",
        entity_id=CITATION_ID,
    )
    payload = payload["data"]

    assert payload["node"]["type"] == "citation"
    assert payload["node"]["id"] == CITATION_ID
    assert [item["id"] for item in payload["collections"]["citations"]] == [CITATION_ID]
    assert [item["id"] for item in payload["collections"]["quotes"]] == [QUOTE_ID]
    assert NOTE_ID in [item["id"] for item in payload["collections"]["notes"]]
    assert [item["id"] for item in payload["collections"]["documents"]] == [DOCUMENT_ID]
    assert any(edge["relation_type"] == "citation_source" for edge in payload["edges"])
    assert any(edge["relation_type"] == "quote_citation" for edge in payload["edges"])
    assert any(edge["relation_type"] == "document_citation" for edge in payload["edges"])
    assert any(edge["relation_type"] == "note_source_citation" and edge["metadata"]["position"] == 0 for edge in payload["edges"])


@pytest.mark.anyio
async def test_document_graph_returns_connected_sources_quotes_notes_and_citations(graph_service):
    payload = await graph_service.get_graph(
        user_id="user-1",
        access_token=None,
        capability_state=DummyCapabilityState(),
        entity="document",
        entity_id=DOCUMENT_ID,
    )
    payload = payload["data"]

    assert payload["node"]["type"] == "document"
    assert [item["id"] for item in payload["collections"]["sources"]] == [SOURCE_ID]
    assert [item["id"] for item in payload["collections"]["citations"]] == [CITATION_ID]
    assert [item["id"] for item in payload["collections"]["quotes"]] == [QUOTE_ID]
    assert [item["id"] for item in payload["collections"]["notes"]] == [NOTE_ID]
    assert any(edge["relation_type"] == "document_note" for edge in payload["edges"])
    assert any(edge["relation_type"] == "note_quote" and edge["to"]["id"] == QUOTE_ID for edge in payload["edges"])


@pytest.mark.anyio
async def test_work_in_editor_orchestration_centralizes_lineage_and_document_attach(graph_service):
    payload = WorkInEditorRequest.model_validate(
        {
            "url": "https://example.com/source",
            "title": "Source A",
            "selected_text": "Quoted context",
            "citation_text": "Source A citation",
            "extraction_payload": {
                "canonical_url": "https://example.com/source",
                "page_url": "https://example.com/source",
                "title_candidates": [{"value": "Source A", "confidence": 1.0}],
                "author_candidates": [{"value": "Example Author", "confidence": 1.0}],
                "date_candidates": [{"value": "2026-01-01", "confidence": 1.0}],
                "locator": {"paragraph": 3},
                "raw_metadata": {"quote": "Quoted context", "excerpt": "Quoted context"},
            },
            "locator": {"paragraph": 3},
            "note": {
                "title": "Captured note",
                "note_body": "Synthesis",
                "sources": [{"source_id": SOURCE_ID, "citation_id": CITATION_ID, "relation_type": "citation", "position": 0}],
            },
        }
    )

    workflow = await graph_service.orchestrate_work_in_editor(
        user_id="user-1",
        access_token=None,
        capability_state=DummyCapabilityState(),
        payload=payload,
        default_document_title="Seeded Draft",
    )

    workspace_service = graph_service.workspace_service
    notes_service = graph_service.notes_service
    citations_service = graph_service.citations_service
    quotes_service = graph_service.quotes_service

    assert citations_service.create_calls[0]["extraction_payload"].canonical_url == "https://example.com/source"
    assert citations_service.create_calls[0]["extraction_payload"].locator == {"paragraph": 3}
    assert citations_service.create_calls[0]["locator"] == {"paragraph": 3}
    assert quotes_service.create_calls[0]["citation_id"] == CITATION_ID
    assert notes_service.create_calls[0]["citation_id"] == CITATION_ID
    assert notes_service.create_calls[0]["quote_id"] == QUOTE_ID
    assert notes_service.create_calls[0]["sources"][0]["source_id"] == SOURCE_ID
    assert workspace_service.create_calls == [{"title": "Seeded Draft", "project_id": None}]
    assert workspace_service.update_calls == [{"revision": "2026-01-06T00:00:00+00:00", "content_delta": {"ops": [{"insert": "Source A\nQuoted context\n\nSynthesis\n"}]}}]
    assert workspace_service.replace_citation_calls == [[CITATION_ID]]
    assert workspace_service.replace_note_calls == [[NOTE_ID]]
    assert workflow["seed"] == {
        "document_id": DOCUMENT_ID,
        "source_id": SOURCE_ID,
        "citation_id": CITATION_ID,
        "quote_id": QUOTE_ID,
        "note_id": NOTE_ID,
        "mode": "quote_focus",
    }
