import importlib
import asyncio
from types import SimpleNamespace

import pytest
import supabase
from fastapi import HTTPException
from pydantic import ValidationError


DOC_ID = "11111111-1111-4111-8111-111111111111"
DOC_CREATED_ID = "22222222-2222-4222-8222-222222222222"
NOTE_ID = "33333333-3333-4333-8333-333333333333"


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, _token):
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyProfileTable:
    def __init__(self, account_type: str):
        self.account_type = account_type

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data={"name": "Schema Tester", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth("user-1")
        self.account_type = account_type

    def table(self, *_args, **_kwargs):
        return DummyProfileTable(self.account_type)


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class SchemaFallbackRepo:
    def __init__(self):
        self.post_payloads = []
        self.patch_payloads = []
        self.get_calls = []

    def headers(self, **_kwargs):
        return {}

    async def get(self, resource, **kwargs):
        self.get_calls.append((resource, kwargs))
        params = kwargs.get("params", {})
        if resource == "documents":
            if "or" in params and "expires_at" in str(params.get("or", "")):
                return FakeResponse(400, {"message": "column documents.expires_at does not exist"})
            if params.get("id", "").startswith("eq."):
                return FakeResponse(200, [{
                    "id": params["id"].replace("eq.", ""),
                    "title": "Doc",
                    "content_delta": {"ops": [{"insert": "x\n"}]},
                    "content_html": "<p>x</p>",
                    "project_id": None,
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "created_at": "2026-01-01T00:00:00+00:00",
                }])
            return FakeResponse(200, [{
                "id": DOC_ID,
                "title": "Doc",
                "project_id": None,
                "updated_at": "2026-01-01T00:00:00+00:00",
                "created_at": "2026-01-01T00:00:00+00:00",
            }])
        if resource == "document_citations":
            return FakeResponse(200, [])
        if resource == "document_tags":
            return FakeResponse(200, [])
        if resource == "citations":
            return FakeResponse(200, [])
        if resource == "notes":
            return FakeResponse(200, [{"id": NOTE_ID}])
        return FakeResponse(200, [])

    async def post(self, resource, **kwargs):
        payload = kwargs.get("json") or {}
        if resource == "documents":
            self.post_payloads.append(payload)
            if "content_html" in payload:
                return FakeResponse(400, {"message": "column content_html does not exist"})
            if "expires_at" in payload:
                return FakeResponse(400, {"message": "column expires_at does not exist"})
            return FakeResponse(201, [{
                "id": DOC_CREATED_ID,
                "title": payload.get("title", "Untitled"),
                "content_delta": payload.get("content_delta", {}),
                "project_id": payload.get("project_id"),
                "updated_at": "2026-01-01T00:00:00+00:00",
            }])
        if resource == "document_citations":
            return FakeResponse(404, {"message": "relation \"document_citations\" does not exist"})
        if resource == "document_tags":
            return FakeResponse(201, [])
        if resource == "document_notes":
            return FakeResponse(404, {"message": "relation \"document_notes\" does not exist"})
        return FakeResponse(201, [])

    async def patch(self, resource, **kwargs):
        payload = kwargs.get("json") or {}
        if resource == "documents":
            self.patch_payloads.append(payload)
            if "content_html" in payload:
                return FakeResponse(400, {"message": "column content_html does not exist"})
            if "expires_at" in payload:
                return FakeResponse(400, {"message": "column expires_at does not exist"})
            return FakeResponse(200, [{"id": DOC_ID, "title": payload.get("title", "Doc")}])
        return FakeResponse(200, [])

    async def delete(self, *_args, **_kwargs):
        return FakeResponse(204, [])

    async def rpc(self, function_name, **_kwargs):
        payload = (_kwargs.get("json") or {})
        if function_name == "replace_document_citations_atomic":
            return FakeResponse(200, payload.get("p_citation_ids", []))
        if function_name == "replace_document_tags_atomic":
            return FakeResponse(200, payload.get("p_tag_ids", []))
        return FakeResponse(404, {"message": f'function "{function_name}" does not exist'})


def _build_app(monkeypatch, account_type="pro"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda _url, _key: DummyClient(account_type))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    main.app.state.http_session = None

    from app.routes import editor
    from app.services import research_entities

    repo = SchemaFallbackRepo()
    editor.supabase_repo = repo
    research_entities.supabase_repo = repo
    return main.app, repo, editor


def _request(account_type: str = "pro"):
    return SimpleNamespace(state=SimpleNamespace(user_id="user-1", account_type=account_type))


def test_create_doc_falls_back_for_missing_content_html_and_expires_at(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)
    response = asyncio.run(editor.create_doc(_request(), editor.DocumentCreate()))

    assert response["id"] == DOC_CREATED_ID
    assert len(repo.post_payloads) >= 3
    assert "content_html" in repo.post_payloads[0]
    assert any("expires_at" in payload for payload in repo.post_payloads[1:])
    assert "content_html" not in repo.post_payloads[-1]
    assert "expires_at" not in repo.post_payloads[-1]


def test_list_docs_falls_back_when_expires_at_filter_missing(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)
    response = asyncio.run(editor.list_docs(_request()))

    assert len(response) == 1
    document_calls = [call for call in repo.get_calls if call[0] == "documents"]
    assert len(document_calls) >= 2
    first_params = document_calls[0][1]["params"]
    second_params = document_calls[1][1]["params"]
    assert "or" in first_params
    assert "or" not in second_params


def test_update_doc_falls_back_when_new_columns_missing(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)
    response = asyncio.run(
        editor.update_doc(
            _request(),
            DOC_ID,
            editor.DocumentUpdate(title="T", content_delta={"ops": [{"insert": "x"}]}, content_html="<p>x</p>", attached_citation_ids=[]),
        )
    )

    assert response["id"] == DOC_ID
    assert len(repo.patch_payloads) >= 3
    assert "content_html" in repo.patch_payloads[0]
    assert any("expires_at" in payload for payload in repo.patch_payloads[1:])
    assert "content_html" not in repo.patch_payloads[-1]
    assert "expires_at" not in repo.patch_payloads[-1]
    assert all("citation_ids" not in payload for payload in repo.patch_payloads)


def test_attach_note_returns_503_when_document_notes_table_missing(monkeypatch):
    _app, _repo, editor = _build_app(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(editor.attach_note_to_doc(_request(), DOC_ID, editor.DocumentNoteCreate(note_id=NOTE_ID)))

    assert excinfo.value.status_code == 503
    payload = excinfo.value.detail
    assert payload["code"] == "DOC_NOTES_SCHEMA_MISSING"


def test_update_doc_rejects_legacy_citation_ids_input(monkeypatch):
    _app, _repo, editor = _build_app(monkeypatch)

    with pytest.raises(ValidationError) as excinfo:
        editor.DocumentUpdate.model_validate(
            {"title": "T", "content_delta": {"ops": [{"insert": "x"}]}, "content_html": "<p>x</p>", "citation_ids": []}
        )

    assert "attached_citation_ids" in str(excinfo.value).lower()
