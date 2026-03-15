import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routes import extension
from app.services import research_entities


USER_ID = "11111111-1111-1111-1111-111111111111"
DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TAG_ALPHA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
TAG_BETA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
CITATION_ALPHA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CITATION_BETA = "ffffffff-ffff-4fff-8fff-ffffffffffff"
LINKED_NOTE_ID = "12121212-1212-4212-8212-121212121212"


class FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload
        self.headers = {}

    def json(self):
        return self._payload


class AtomicReplaceRepo:
    def __init__(self):
        self.calls = []
        self.fail_functions: set[str] = set()
        self.tags = {
            TAG_ALPHA: {"id": TAG_ALPHA, "user_id": USER_ID, "name": "alpha", "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"},
            TAG_BETA: {"id": TAG_BETA, "user_id": USER_ID, "name": "beta", "created_at": "2026-01-02T00:00:00+00:00", "updated_at": "2026-01-02T00:00:00+00:00"},
        }
        self.documents = {DOC_ID: {"id": DOC_ID, "user_id": USER_ID}}
        self.notes = {
            NOTE_ID: {"id": NOTE_ID, "user_id": USER_ID},
            LINKED_NOTE_ID: {"id": LINKED_NOTE_ID, "user_id": USER_ID},
        }
        self.document_tags = [(DOC_ID, TAG_ALPHA)]
        self.document_citations = [(DOC_ID, CITATION_ALPHA)]
        self.note_tag_links = [(NOTE_ID, TAG_ALPHA)]
        self.note_sources = {
            NOTE_ID: [
                {
                    "url": "https://example.com/original",
                    "title": "Original",
                    "hostname": "example.com",
                    "source_author": "Original Author",
                    "source_published_at": "2026-01-01T00:00:00+00:00",
                    "attached_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        }
        self.note_links = {NOTE_ID: [LINKED_NOTE_ID]}

    def headers(self, **_kwargs):
        return {}

    async def get(self, resource, **kwargs):
        self.calls.append(("get", resource, kwargs))
        params = kwargs.get("params", {})
        if resource == "tags":
            requested_ids = params.get("id", "")
            ids = {item.strip() for item in requested_ids[4:-1].split(",") if item.strip()} if requested_ids.startswith("in.(") else set(self.tags)
            rows = [self.tags[tag_id] for tag_id in ids if tag_id in self.tags and self.tags[tag_id]["user_id"] == USER_ID]
            return FakeResponse(200, rows)
        if resource == "document_tags":
            doc_filter = params.get("document_id", "")
            if doc_filter.startswith("eq."):
                doc_ids = {doc_filter.replace("eq.", "")}
            elif doc_filter.startswith("in.("):
                doc_ids = {item.strip() for item in doc_filter[4:-1].split(",") if item.strip()}
            else:
                doc_ids = {document_id for document_id, _tag_id in self.document_tags}
            rows = []
            for current_doc_id, tag_id in self.document_tags:
                if current_doc_id not in doc_ids:
                    continue
                tag = self.tags[tag_id]
                rows.append(
                    {
                        "document_id": current_doc_id,
                        "tag_id": tag_id,
                        "created_at": "2026-01-03T00:00:00+00:00",
                        "tags": tag,
                    }
                )
            return FakeResponse(200, rows)
        if resource == "notes":
            note_id = params.get("id", "").replace("eq.", "")
            note = self.notes.get(note_id)
            return FakeResponse(200, [note] if note and note["user_id"] == USER_ID else [])
        if resource == "note_sources":
            note_id = params.get("note_id", "").replace("eq.", "")
            return FakeResponse(200, list(self.note_sources.get(note_id, [])))
        return FakeResponse(200, [])

    async def post(self, resource, **kwargs):
        self.calls.append(("post", resource, kwargs))
        raise AssertionError(f"unexpected fallback post to {resource}")

    async def delete(self, resource, **kwargs):
        self.calls.append(("delete", resource, kwargs))
        raise AssertionError(f"unexpected fallback delete to {resource}")

    async def rpc(self, function_name, **kwargs):
        self.calls.append(("rpc", function_name, kwargs))
        payload = kwargs.get("json") or {}
        if function_name in self.fail_functions:
            return FakeResponse(400, {"code": "P0001", "message": "invalid_related_rows"})
        if function_name == "replace_document_citations_atomic":
            citation_ids = list(payload.get("p_citation_ids", []))
            self.document_citations = [(payload["p_document_id"], citation_id) for citation_id in citation_ids]
            return FakeResponse(200, citation_ids)
        if function_name == "replace_document_tags_atomic":
            tag_ids = list(payload.get("p_tag_ids", []))
            self.document_tags = [(payload["p_document_id"], tag_id) for tag_id in tag_ids]
            return FakeResponse(200, tag_ids)
        if function_name == "replace_note_tag_links_atomic":
            tag_ids = list(payload.get("p_tag_ids", []))
            self.note_tag_links = [(payload["p_note_id"], tag_id) for tag_id in tag_ids]
            return FakeResponse(200, tag_ids)
        if function_name == "replace_note_sources_atomic":
            sources = list(payload.get("p_sources", []))
            self.note_sources[payload["p_note_id"]] = sources
            return FakeResponse(200, sources)
        if function_name == "replace_note_links_atomic":
            linked_note_ids = list(payload.get("p_linked_note_ids", []))
            self.note_links[payload["p_note_id"]] = linked_note_ids
            return FakeResponse(200, linked_note_ids)
        return FakeResponse(404, {"message": f'function "{function_name}" does not exist'})


@pytest.fixture
def atomic_repo(monkeypatch):
    repo = AtomicReplaceRepo()
    monkeypatch.setattr(research_entities, "supabase_repo", repo)
    monkeypatch.setattr(extension, "supabase_repo", repo)
    return repo


def test_document_citations_failure_keeps_prior_rows(atomic_repo):
    atomic_repo.fail_functions.add("replace_document_citations_atomic")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_document_citations(USER_ID, DOC_ID, [CITATION_BETA]))

    assert excinfo.value.status_code == 500
    assert atomic_repo.document_citations == [(DOC_ID, CITATION_ALPHA)]


def test_document_tags_failure_keeps_prior_rows_and_old_read_shape(atomic_repo):
    atomic_repo.fail_functions.add("replace_document_tags_atomic")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_document_tags(USER_ID, DOC_ID, [TAG_BETA]))

    assert excinfo.value.status_code == 500
    tag_rows = asyncio.run(research_entities.list_document_tags(USER_ID, DOC_ID))
    assert [row["id"] for row in tag_rows] == [TAG_ALPHA]


def test_note_tag_links_failure_keeps_prior_rows(atomic_repo):
    atomic_repo.fail_functions.add("replace_note_tag_links_atomic")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_note_tag_links(USER_ID, NOTE_ID, [TAG_BETA]))

    assert excinfo.value.status_code == 500
    assert atomic_repo.note_tag_links == [(NOTE_ID, TAG_ALPHA)]


def test_note_sources_failure_keeps_prior_rows_and_route_still_reads_old_state(atomic_repo):
    atomic_repo.fail_functions.add("replace_note_sources_atomic")
    request = SimpleNamespace(state=SimpleNamespace(user_id=USER_ID))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            research_entities.replace_note_sources(
                USER_ID,
                NOTE_ID,
                [{"url": "https://example.com/new", "title": "New", "hostname": "example.com", "attached_at": "2026-01-02T00:00:00+00:00"}],
            )
        )

    assert excinfo.value.status_code == 500
    response = asyncio.run(extension.get_note_sources(request, NOTE_ID))
    assert response["sources"] == atomic_repo.note_sources[NOTE_ID]


def test_note_sources_preserve_author_and_published_metadata(atomic_repo):
    applied = asyncio.run(
        research_entities.replace_note_sources(
            USER_ID,
            NOTE_ID,
            [
                {
                    "url": "https://example.com/new",
                    "title": "New",
                    "hostname": "example.com",
                    "source_author": "New Author",
                    "source_published_at": "2026-01-02T00:00:00+00:00",
                    "attached_at": "2026-01-03T00:00:00+00:00",
                }
            ],
        )
    )

    assert applied == [
        {
            "url": "https://example.com/new",
            "title": "New",
            "hostname": "example.com",
            "source_author": "New Author",
            "source_published_at": "2026-01-02T00:00:00+00:00",
            "attached_at": "2026-01-03T00:00:00+00:00",
        }
    ]
    assert atomic_repo.note_sources[NOTE_ID] == applied


def test_note_links_failure_keeps_prior_rows(atomic_repo):
    atomic_repo.fail_functions.add("replace_note_links_atomic")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_note_links(USER_ID, NOTE_ID, [NOTE_ID]))

    assert excinfo.value.status_code == 500
    assert atomic_repo.note_links[NOTE_ID] == [LINKED_NOTE_ID]


def test_missing_rpc_fails_loudly_without_rest_fallback(atomic_repo):
    async def missing_rpc(function_name, **kwargs):
        atomic_repo.calls.append(("rpc", function_name, kwargs))
        return FakeResponse(404, {"message": f'function "{function_name}" does not exist'})

    atomic_repo.rpc = missing_rpc

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_document_tags(USER_ID, DOC_ID, [TAG_ALPHA]))

    assert excinfo.value.status_code == 503
    assert not any(call[0] in {"post", "delete"} for call in atomic_repo.calls)


def test_duplicate_inputs_are_deduped_in_order_before_rpc(atomic_repo):
    applied = asyncio.run(
        research_entities.replace_document_citations(
            USER_ID,
            DOC_ID,
            [CITATION_BETA, CITATION_ALPHA, CITATION_BETA, CITATION_ALPHA],
        )
    )

    assert applied == [CITATION_BETA, CITATION_ALPHA]
    rpc_call = [call for call in atomic_repo.calls if call[0] == "rpc" and call[1] == "replace_document_citations_atomic"][-1]
    assert rpc_call[2]["json"]["p_citation_ids"] == [CITATION_BETA, CITATION_ALPHA]


def test_empty_input_clears_note_links_successfully(atomic_repo):
    applied = asyncio.run(research_entities.replace_note_links(USER_ID, NOTE_ID, []))

    assert applied == []
    assert atomic_repo.note_links[NOTE_ID] == []


def test_malformed_uuid_rejected_before_rpc(atomic_repo):
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.replace_document_citations(USER_ID, "not-a-uuid", [CITATION_ALPHA]))

    assert excinfo.value.status_code == 422
    assert not any(call[0] == "rpc" for call in atomic_repo.calls)
