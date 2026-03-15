import asyncio
import importlib
from copy import deepcopy
from types import SimpleNamespace

import pytest
import supabase
from fastapi import HTTPException


USER_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_USER_ID = "22222222-2222-2222-2222-222222222222"
DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CITATION_ALPHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
CITATION_BETA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
CITATION_GAMMA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
CITATION_DELTA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
CITATION_FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff"
NONEXISTENT_CITATION = "12121212-1212-4212-8212-121212121212"


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
        return SimpleNamespace(data={"name": "Citation Tester", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth(USER_ID)
        self.account_type = account_type

    def table(self, *_args, **_kwargs):
        return DummyProfileTable(self.account_type)


class DummyResp:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class DocumentCitationRepo:
    def __init__(self, *, account_type: str = "pro"):
        created_at = "2026-01-01T00:00:00+00:00" if account_type == "pro" else "2020-01-01T00:00:00+00:00"
        self.documents = {
            DOC_ID: {
                "id": DOC_ID,
                "title": "Draft",
                "content_delta": {"ops": [{"insert": "Hello\n"}]},
                "content_html": "<p>Hello</p>",
                "project_id": None,
                "expires_at": None,
                "created_at": created_at,
                "updated_at": "2026-01-02T00:00:00+00:00",
                "user_id": USER_ID,
            }
        }
        self.citation_instances = {
            CITATION_ALPHA: {"id": CITATION_ALPHA, "user_id": USER_ID},
            CITATION_BETA: {"id": CITATION_BETA, "user_id": USER_ID},
            CITATION_GAMMA: {"id": CITATION_GAMMA, "user_id": USER_ID},
            CITATION_DELTA: {"id": CITATION_DELTA, "user_id": USER_ID},
            CITATION_FOREIGN: {"id": CITATION_FOREIGN, "user_id": FOREIGN_USER_ID},
        }
        self.document_citations = [
            {"document_id": DOC_ID, "citation_id": CITATION_BETA, "user_id": USER_ID, "attached_at": "2026-01-05T00:00:00+00:00"},
            {"document_id": DOC_ID, "citation_id": CITATION_ALPHA, "user_id": USER_ID, "attached_at": "2026-01-05T00:00:00+00:00"},
        ]
        self.rpc_calls = []
        self.patch_payloads = []

    def headers(self, **_kwargs):
        return {}

    async def get(self, resource, **kwargs):
        params = kwargs.get("params", {})
        if resource == "documents":
            doc_id = params.get("id", "").replace("eq.", "")
            doc = self.documents.get(doc_id)
            if doc and doc.get("user_id") == USER_ID:
                return DummyResp(200, [deepcopy(doc)])
            return DummyResp(200, [])
        if resource == "document_citations":
            return DummyResp(200, self._document_citation_rows(params))
        if resource == "document_tags":
            return DummyResp(200, [])
        if resource == "citation_instances":
            return DummyResp(200, self._citation_instance_rows(params))
        return DummyResp(200, [])

    async def post(self, resource, **kwargs):
        if resource == "documents":
            payload = kwargs.get("json") or {}
            created = {
                "id": DOC_ID,
                "title": payload.get("title") or "Untitled",
                "content_delta": payload.get("content_delta") or {"ops": [{"insert": "\n"}]},
                "content_html": payload.get("content_html"),
                "project_id": payload.get("project_id"),
                "expires_at": payload.get("expires_at"),
                "created_at": payload.get("created_at") or "2026-01-01T00:00:00+00:00",
                "updated_at": payload.get("updated_at") or "2026-01-01T00:00:00+00:00",
                "user_id": payload.get("user_id") or USER_ID,
            }
            self.documents[DOC_ID] = created
            return DummyResp(201, [deepcopy(created)])
        return DummyResp(201, [])

    async def patch(self, resource, **kwargs):
        if resource != "documents":
            return DummyResp(200, [])
        payload = kwargs.get("json") or {}
        self.patch_payloads.append(payload)
        doc_id = kwargs.get("params", {}).get("id", "").replace("eq.", "")
        doc = self.documents[doc_id]
        doc.update(payload)
        return DummyResp(200, [deepcopy(doc)])

    async def delete(self, resource, **kwargs):
        return DummyResp(204, [])

    async def rpc(self, function_name, **kwargs):
        payload = kwargs.get("json") or {}
        self.rpc_calls.append((function_name, deepcopy(payload)))
        if function_name == "replace_document_citations_atomic":
            document_id = payload.get("p_document_id")
            citation_ids = list(payload.get("p_citation_ids") or [])
            self.document_citations = [row for row in self.document_citations if row["document_id"] != document_id]
            for index, citation_id in enumerate(citation_ids):
                self.document_citations.append(
                    {
                        "document_id": document_id,
                        "citation_id": citation_id,
                        "user_id": USER_ID,
                        "attached_at": f"2026-02-01T00:00:00.{index:06d}+00:00",
                    }
                )
            return DummyResp(200, citation_ids)
        if function_name == "replace_document_tags_atomic":
            return DummyResp(200, payload.get("p_tag_ids", []))
        return DummyResp(404, {"message": f'function "{function_name}" does not exist'})

    def _document_citation_rows(self, params):
        user_id = params.get("user_id", "").replace("eq.", "")
        doc_filter = params.get("document_id", "")
        if doc_filter.startswith("eq."):
            doc_ids = {doc_filter.replace("eq.", "")}
        elif doc_filter.startswith("in.("):
            doc_ids = {item.strip() for item in doc_filter[4:-1].split(",") if item.strip()}
        else:
            doc_ids = {row["document_id"] for row in self.document_citations}

        rows = [
            deepcopy(row)
            for row in self.document_citations
            if row["user_id"] == user_id and row["document_id"] in doc_ids
        ]
        rows.sort(key=lambda row: (row["attached_at"], row["citation_id"]))
        return rows

    def _citation_instance_rows(self, params):
        ids_filter = params.get("id", "")
        if ids_filter.startswith("in.("):
            ids = [item.strip() for item in ids_filter[4:-1].split(",") if item.strip()]
        else:
            ids = list(self.citation_instances)
        rows = []
        for citation_id in ids:
            row = self.citation_instances.get(citation_id)
            if row:
                rows.append(deepcopy(row))
        return rows


def _citation_record(citation_id: str) -> dict:
    return {
        "id": citation_id,
        "format": "mla",
        "excerpt": f"Excerpt {citation_id[-4:]}",
        "full_citation": f"Full citation {citation_id[-4:]}",
        "url": f"https://example.com/{citation_id}",
        "source": {"title": f"Title {citation_id[-4:]}"},
    }


def _build_app(monkeypatch, *, account_type: str = "pro"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda _url, _key: DummyClient(account_type))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

    async def redis_set(_key, _value, ttl_seconds=None):
        return True

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    main.app.state.http_session = None

    from app.routes import citations, editor
    from app.services import research_entities

    repo = DocumentCitationRepo(account_type=account_type)
    editor.supabase_repo = repo
    research_entities.supabase_repo = repo

    async def fake_list_citation_records(_user_id, *, ids=None, limit=50, search=None, format=None):
        del limit, search, format
        requested = list(ids or [])
        # Return reversed order to ensure hydration reorders to relation order.
        return [_citation_record(citation_id) for citation_id in reversed(requested)]

    citations.list_citation_records = fake_list_citation_records
    return main.app, repo, editor


def _request(account_type: str = "pro"):
    return SimpleNamespace(state=SimpleNamespace(user_id=USER_ID, account_type=account_type))


def test_document_citation_list_returns_hydrated_canonical_order(monkeypatch):
    _app, _repo, editor = _build_app(monkeypatch)

    response = asyncio.run(editor.get_doc_citations(_request(), DOC_ID))

    assert [item["citation_id"] for item in response] == [CITATION_ALPHA, CITATION_BETA]
    assert [item["doc_id"] for item in response] == [DOC_ID, DOC_ID]
    assert all(item["citation"]["id"] == item["citation_id"] for item in response)


def test_document_citation_post_appends_deduped_owned_ids_without_clearing(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)

    response = asyncio.run(
        editor.add_doc_citations(
            _request(),
            DOC_ID,
            editor.DocumentCitationWrite(citation_ids=[CITATION_BETA, CITATION_GAMMA, CITATION_DELTA, CITATION_GAMMA]),
        )
    )

    assert [item["citation_id"] for item in response] == [CITATION_ALPHA, CITATION_BETA, CITATION_GAMMA, CITATION_DELTA]
    assert repo.rpc_calls[-1][0] == "replace_document_citations_atomic"
    assert repo.rpc_calls[-1][1]["p_citation_ids"] == [CITATION_ALPHA, CITATION_BETA, CITATION_GAMMA, CITATION_DELTA]


def test_document_citation_post_empty_list_is_noop(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)

    response = asyncio.run(editor.add_doc_citations(_request(), DOC_ID, editor.DocumentCitationWrite(citation_ids=[])))

    assert [item["citation_id"] for item in response] == [CITATION_ALPHA, CITATION_BETA]
    assert repo.rpc_calls == []


def test_document_citation_put_replaces_in_deduped_payload_order_and_supports_clear(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)

    replaced = asyncio.run(
        editor.replace_doc_citations(
            _request(),
            DOC_ID,
            editor.DocumentCitationWrite(citation_ids=[CITATION_DELTA, CITATION_ALPHA, CITATION_DELTA, CITATION_GAMMA]),
        )
    )
    cleared = asyncio.run(editor.replace_doc_citations(_request(), DOC_ID, editor.DocumentCitationWrite(citation_ids=[])))

    assert [item["citation_id"] for item in replaced] == [CITATION_DELTA, CITATION_ALPHA, CITATION_GAMMA]
    assert repo.rpc_calls[0][1]["p_citation_ids"] == [CITATION_DELTA, CITATION_ALPHA, CITATION_GAMMA]
    assert cleared == []
    assert repo.rpc_calls[1][1]["p_citation_ids"] == []


def test_document_citation_delete_removes_relation_and_missing_relation_is_noop(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)

    removed = asyncio.run(editor.delete_doc_citation(_request(), DOC_ID, CITATION_ALPHA))
    noop = asyncio.run(editor.delete_doc_citation(_request(), DOC_ID, CITATION_DELTA))

    assert removed == {"ok": True, "doc_id": DOC_ID, "citation_id": CITATION_ALPHA}
    assert noop == {"ok": True, "doc_id": DOC_ID, "citation_id": CITATION_DELTA}
    assert repo.rpc_calls[0][1]["p_citation_ids"] == [CITATION_BETA]
    assert len(repo.rpc_calls) == 1


def test_document_citation_rejects_foreign_and_nonexistent_ids(monkeypatch):
    _app, _repo, editor = _build_app(monkeypatch)

    with pytest.raises(HTTPException) as foreign_excinfo:
        asyncio.run(editor.add_doc_citations(_request(), DOC_ID, editor.DocumentCitationWrite(citation_ids=[CITATION_FOREIGN])))
    with pytest.raises(HTTPException) as missing_excinfo:
        asyncio.run(editor.replace_doc_citations(_request(), DOC_ID, editor.DocumentCitationWrite(citation_ids=[NONEXISTENT_CITATION])))

    assert foreign_excinfo.value.status_code == 403
    assert missing_excinfo.value.status_code == 404


def test_document_citation_routes_respect_archived_document_mutation_guard(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch, account_type="standard")

    with pytest.raises(HTTPException) as post_excinfo:
        asyncio.run(editor.add_doc_citations(_request("standard"), DOC_ID, editor.DocumentCitationWrite(citation_ids=[CITATION_GAMMA])))
    with pytest.raises(HTTPException) as put_excinfo:
        asyncio.run(editor.replace_doc_citations(_request("standard"), DOC_ID, editor.DocumentCitationWrite(citation_ids=["not-a-uuid"])))
    with pytest.raises(HTTPException) as delete_excinfo:
        asyncio.run(editor.delete_doc_citation(_request("standard"), DOC_ID, CITATION_ALPHA))

    assert post_excinfo.value.status_code == 403
    assert put_excinfo.value.status_code == 403
    assert delete_excinfo.value.status_code == 403
    assert repo.rpc_calls == []


def test_document_update_and_relation_routes_converge_on_same_canonical_state(monkeypatch):
    _app, repo, editor = _build_app(monkeypatch)
    request = _request()

    asyncio.run(
        editor.update_doc(
            request,
            DOC_ID,
            editor.DocumentUpdate(
                title="Updated",
                content_delta={"ops": [{"insert": "Changed\n"}]},
                content_html="<p>Changed</p>",
                attached_citation_ids=[CITATION_GAMMA, CITATION_ALPHA, CITATION_GAMMA],
            ),
        )
    )
    relation_response = asyncio.run(
        editor.replace_doc_citations(
            request,
            DOC_ID,
            editor.DocumentCitationWrite(citation_ids=[CITATION_DELTA, CITATION_BETA]),
        )
    )
    serialized = asyncio.run(editor.get_doc(request, DOC_ID))

    assert repo.rpc_calls[0][1]["p_citation_ids"] == [CITATION_GAMMA, CITATION_ALPHA]
    assert repo.rpc_calls[1][1]["p_citation_ids"] == [CITATION_DELTA, CITATION_BETA]
    assert [item["citation_id"] for item in relation_response] == [CITATION_DELTA, CITATION_BETA]
    assert serialized["attached_citation_ids"] == [CITATION_DELTA, CITATION_BETA]
    assert serialized["citation_ids"] == [CITATION_DELTA, CITATION_BETA]
