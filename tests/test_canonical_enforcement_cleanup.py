import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routes import citations, extension


class DummyResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_follow_up_migration_makes_compatibility_views_read_only():
    source = Path("sql/20260322_enforce_canonical_runtime_contracts.sql").read_text()

    assert "alter table public.note_tags rename to note_tag_links" in source
    assert 'create view public.note_tags as' in source
    assert 'from public.tags;' in source
    assert 'create trigger note_projects_read_only' in source
    assert 'create trigger note_tags_read_only' in source
    assert 'create trigger note_note_tags_read_only' in source


def test_list_citation_records_no_longer_falls_back_to_public_citations(monkeypatch):
    class MissingCanonicalRepo:
        def headers(self, **_kwargs):
            return {}

        async def get(self, resource, **_kwargs):
            if resource == "citation_instances":
                return DummyResponse(404, {"message": 'relation "citation_instances" does not exist'})
            raise AssertionError(f"unexpected repo resource: {resource}")

    class NoLegacyHttpClient:
        async def get(self, *_args, **_kwargs):
            raise AssertionError("legacy public.citations fallback should not be used")

    monkeypatch.setattr(citations, "supabase_repo", MissingCanonicalRepo())
    monkeypatch.setattr(citations, "http_client", NoLegacyHttpClient())

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(citations.list_citation_records("user-1", limit=5))

    assert excinfo.value.status_code == 503


def test_delete_citation_no_longer_falls_back_to_public_citations(monkeypatch):
    class MissingCanonicalRepo:
        def headers(self, **_kwargs):
            return {}

        async def delete(self, resource, **_kwargs):
            assert resource == "citation_instances"
            return DummyResponse(404, {"message": 'relation "citation_instances" does not exist'})

    class NoLegacyHttpClient:
        async def delete(self, *_args, **_kwargs):
            raise AssertionError("legacy public.citations fallback should not be used")

    request = SimpleNamespace(state=SimpleNamespace(user_id="user-1"))
    monkeypatch.setattr(citations, "supabase_repo", MissingCanonicalRepo())
    monkeypatch.setattr(citations, "http_client", NoLegacyHttpClient())

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(citations.delete_citation(request, "citation-1"))

    assert excinfo.value.status_code == 503


def test_extension_selection_writes_document_citations_only(monkeypatch):
    document_posts = []
    document_citation_writes = []

    class Repo:
        def headers(self, **_kwargs):
            return {}

        async def post(self, resource, **kwargs):
            assert resource == "documents"
            document_posts.append(kwargs.get("json") or {})
            return DummyResponse(201, [{"id": "doc-1"}])

    async def fake_create_citation(*_args, **_kwargs):
        return "citation-1"

    async def fake_replace_document_citations(user_id, document_id, citation_ids):
        document_citation_writes.append((user_id, document_id, citation_ids))
        return citation_ids

    async def redis_get(_key):
        return 0

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    request = SimpleNamespace(
        state=SimpleNamespace(user_id="user-1", account_type="pro"),
        app=SimpleNamespace(state=SimpleNamespace(redis_get=redis_get, redis_incr=redis_incr, redis_expire=redis_expire)),
    )
    payload = extension.ExtensionSelectionRequest(
        url="https://example.com/article",
        title="Example",
        selected_text="Selected source text",
        citation_format="mla",
        citation_text="Selected source text",
    )

    monkeypatch.setattr(extension, "supabase_repo", Repo())
    monkeypatch.setattr(extension, "create_citation", fake_create_citation)
    monkeypatch.setattr(extension, "replace_document_citations", fake_replace_document_citations)

    response = asyncio.run(extension.extension_selection(request, payload))

    assert response["doc_id"] == "doc-1"
    assert len(document_posts) == 1
    assert document_posts[0]["user_id"] == "user-1"
    assert document_posts[0]["title"] == "Example"
    assert document_posts[0]["content_delta"] == {"ops": [{"insert": "Selected source text\n"}]}
    assert document_posts[0]["expires_at"] is not None
    assert "citation_ids" not in document_posts[0]
    assert document_citation_writes == [("user-1", "doc-1", ["citation-1"])]


def test_note_project_alias_routes_delegate_to_canonical_wrappers(monkeypatch):
    request = SimpleNamespace()
    payload = extension.NoteProjectPayload(name="Project")

    async def fake_list_projects(_request):
        return ["projects"]

    async def fake_create_project(_request, _payload):
        return {"id": "project-1"}

    async def fake_delete_project(_request, project_id):
        return {"ok": True, "id": project_id}

    monkeypatch.setattr(extension, "list_projects", fake_list_projects)
    monkeypatch.setattr(extension, "create_project", fake_create_project)
    monkeypatch.setattr(extension, "delete_project", fake_delete_project)

    assert asyncio.run(extension.list_note_projects(request)) == ["projects"]
    assert asyncio.run(extension.create_note_project(request, payload)) == {"id": "project-1"}
    assert asyncio.run(extension.delete_note_project(request, "project-1")) == {"ok": True, "id": "project-1"}


def test_editor_client_no_longer_reads_citation_ids_fallback():
    source = Path("app/static/js/editor.js").read_text()

    assert "serverDoc.citation_ids" not in source
    assert "doc.citation_ids" not in source
    assert "effective.citation_ids" not in source
