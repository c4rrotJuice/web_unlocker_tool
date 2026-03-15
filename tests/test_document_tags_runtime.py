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
TAG_ALPHA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TAG_BETA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
TAG_FOREIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
CHECKPOINT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"


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
        return SimpleNamespace(data={"name": "Doc Tag Tester", "account_type": self.account_type, "daily_limit": 5})


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


class DocumentTagRepo:
    def __init__(self, *, schema_missing: bool = False):
        self.schema_missing = schema_missing
        self.documents = {
            DOC_ID: {
                "id": DOC_ID,
                "title": "Draft",
                "content_delta": {"ops": [{"insert": "Hello\n"}]},
                "content_html": "<p>Hello</p>",
                "project_id": None,
                "expires_at": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
                "user_id": USER_ID,
            }
        }
        self.tags = {
            TAG_ALPHA: {"id": TAG_ALPHA, "user_id": USER_ID, "name": "alpha", "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"},
            TAG_BETA: {"id": TAG_BETA, "user_id": USER_ID, "name": "beta", "created_at": "2026-01-03T00:00:00+00:00", "updated_at": "2026-01-03T00:00:00+00:00"},
            TAG_FOREIGN: {"id": TAG_FOREIGN, "user_id": FOREIGN_USER_ID, "name": "foreign", "created_at": "2026-01-04T00:00:00+00:00", "updated_at": "2026-01-04T00:00:00+00:00"},
        }
        self.document_tags = {(DOC_ID, TAG_ALPHA)}
        self.note_tag_links = set()
        self.document_citations = set()
        self.checkpoints = {
            CHECKPOINT_ID: {
                "id": CHECKPOINT_ID,
                "doc_id": DOC_ID,
                "user_id": USER_ID,
                "content_delta": {"ops": [{"insert": "Restored\n"}]},
                "content_html": "<p>Restored</p>",
            }
        }

    def headers(self, **_kwargs):
        return {}

    async def get(self, resource, **kwargs):
        params = kwargs.get("params", {})
        if resource == "documents":
            if params.get("id", "").startswith("eq."):
                doc = self.documents.get(params["id"].replace("eq.", ""))
                return DummyResp(200, [deepcopy(doc)] if doc else [])
            docs = [deepcopy(doc) for doc in self.documents.values() if doc.get("user_id") == USER_ID]
            return DummyResp(200, docs)
        if resource == "document_citations":
            return DummyResp(200, [])
        if resource == "document_tags":
            if self.schema_missing:
                return DummyResp(404, {"message": 'relation "document_tags" does not exist'})
            return DummyResp(200, self._document_tag_rows(params))
        if resource == "tags":
            return DummyResp(200, self._tag_rows(params))
        if resource == "doc_checkpoints":
            checkpoint_id = params.get("id", "").replace("eq.", "")
            row = self.checkpoints.get(checkpoint_id)
            return DummyResp(200, [deepcopy(row)] if row else [])
        if resource == "citations":
            return DummyResp(200, [])
        return DummyResp(200, [])

    async def post(self, resource, **kwargs):
        payload = kwargs.get("json") or {}
        if resource == "documents":
            doc_id = payload.get("id") or DOC_ID
            doc = {
                "id": doc_id,
                "title": payload.get("title") or "Untitled",
                "content_delta": payload.get("content_delta") or {"ops": [{"insert": "\n"}]},
                "content_html": payload.get("content_html"),
                "project_id": payload.get("project_id"),
                "expires_at": payload.get("expires_at"),
                "created_at": payload.get("created_at") or "2026-01-05T00:00:00+00:00",
                "updated_at": payload.get("updated_at") or "2026-01-05T00:00:00+00:00",
                "user_id": payload.get("user_id") or USER_ID,
            }
            self.documents[doc_id] = doc
            return DummyResp(201, [deepcopy(doc)])
        if resource == "document_citations":
            return DummyResp(201, [])
        if resource == "document_tags":
            if self.schema_missing:
                return DummyResp(404, {"message": 'relation "document_tags" does not exist'})
            rows = payload if isinstance(payload, list) else [payload]
            for row in rows:
                self.document_tags.add((row["document_id"], row["tag_id"]))
            return DummyResp(201, [])
        return DummyResp(201, [])

    async def patch(self, resource, **kwargs):
        if resource != "documents":
            return DummyResp(200, [])
        doc_id = kwargs.get("params", {}).get("id", "").replace("eq.", "")
        doc = self.documents[doc_id]
        doc.update(kwargs.get("json") or {})
        return DummyResp(200, [deepcopy(doc)])

    async def delete(self, resource, **kwargs):
        params = kwargs.get("params", {})
        if resource == "document_citations":
            return DummyResp(204, [])
        if resource == "document_tags":
            if self.schema_missing:
                return DummyResp(404, {"message": 'relation "document_tags" does not exist'})
            doc_id = params.get("document_id", "").replace("eq.", "")
            tag_id = params.get("tag_id", "").replace("eq.", "")
            if tag_id:
                self.document_tags.discard((doc_id, tag_id))
            else:
                self.document_tags = {link for link in self.document_tags if link[0] != doc_id}
            return DummyResp(204, [])
        return DummyResp(204, [])

    async def rpc(self, function_name, **kwargs):
        if self.schema_missing:
            return DummyResp(404, {"message": f'function "{function_name}" does not exist'})
        payload = kwargs.get("json") or {}
        if function_name == "replace_document_tags_atomic":
            document_id = payload.get("p_document_id")
            tag_ids = payload.get("p_tag_ids", [])
            self.document_tags = {link for link in self.document_tags if link[0] != document_id}
            for tag_id in tag_ids:
                self.document_tags.add((document_id, tag_id))
            return DummyResp(200, tag_ids)
        if function_name == "replace_document_citations_atomic":
            document_id = payload.get("p_document_id")
            citation_ids = payload.get("p_citation_ids", [])
            self.document_citations = {link for link in self.document_citations if link[0] != document_id}
            for citation_id in citation_ids:
                self.document_citations.add((document_id, citation_id))
            return DummyResp(200, citation_ids)
        if function_name == "replace_note_tag_links_atomic":
            note_id = payload.get("p_note_id")
            tag_ids = payload.get("p_tag_ids", [])
            invalid = [tag_id for tag_id in tag_ids if self.tags.get(tag_id, {}).get("user_id") != USER_ID]
            if invalid:
                return DummyResp(400, {"code": "P0001", "message": "invalid_related_rows"})
            self.note_tag_links = {link for link in self.note_tag_links if link[0] != note_id}
            for tag_id in tag_ids:
                self.note_tag_links.add((note_id, tag_id))
            return DummyResp(200, tag_ids)
        return DummyResp(404, {"message": f'function "{function_name}" does not exist'})

    def _document_tag_rows(self, params):
        doc_filter = params.get("document_id", "")
        if doc_filter.startswith("eq."):
            doc_ids = {doc_filter.replace("eq.", "")}
        elif doc_filter.startswith("in.("):
            doc_ids = {item.strip() for item in doc_filter[4:-1].split(",") if item.strip()}
        else:
            doc_ids = {doc_id for doc_id, _tag_id in self.document_tags}
        rows = []
        for document_id, tag_id in sorted(self.document_tags):
            if document_id not in doc_ids:
                continue
            tag = self.tags[tag_id]
            rows.append(
                {
                    "document_id": document_id,
                    "tag_id": tag_id,
                    "created_at": "2026-01-06T00:00:00+00:00",
                    "tags": {
                        "id": tag["id"],
                        "name": tag["name"],
                        "created_at": tag["created_at"],
                        "updated_at": tag["updated_at"],
                    },
                }
            )
        return rows

    def _tag_rows(self, params):
        user_id = params.get("user_id", "").replace("eq.", "")
        ids_filter = params.get("id", "")
        if ids_filter.startswith("in.("):
            ids = {item.strip() for item in ids_filter[4:-1].split(",") if item.strip()}
        else:
            ids = set(self.tags.keys())
        rows = []
        for tag_id in ids:
            tag = self.tags.get(tag_id)
            if not tag or tag["user_id"] != user_id:
                continue
            rows.append(deepcopy(tag))
        return rows


def _build_app(monkeypatch, repo=None, account_type="pro"):
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

    from app.routes import editor
    from app.services import research_entities

    repo = repo or DocumentTagRepo()
    editor.supabase_repo = repo
    research_entities.supabase_repo = repo
    return main.app, repo, editor, research_entities


def _request(account_type: str = "pro"):
    return SimpleNamespace(state=SimpleNamespace(user_id=USER_ID, account_type=account_type))


def test_document_endpoints_return_consistent_tag_shape(monkeypatch):
    _app, repo, editor, _research_entities = _build_app(monkeypatch)
    request = _request()

    created = asyncio.run(editor.create_doc(request, editor.DocumentCreate(title="Created", tag_ids=[TAG_ALPHA, TAG_BETA])))
    fetched = asyncio.run(editor.get_doc(request, DOC_ID))
    listed = asyncio.run(editor.list_docs(request))
    updated = asyncio.run(
        editor.update_doc(
            request,
            DOC_ID,
            editor.DocumentUpdate(
                title="Updated",
                content_delta={"ops": [{"insert": "Changed\n"}]},
                content_html="<p>Changed</p>",
                attached_citation_ids=[],
                tag_ids=[TAG_BETA],
            ),
        )
    )
    restored = asyncio.run(editor.restore_doc_checkpoint(request, DOC_ID, editor.RestoreCheckpointRequest(checkpoint_id=CHECKPOINT_ID)))

    create_payload = created
    get_payload = fetched
    list_payload = listed[0]
    update_payload = updated
    restore_payload = restored

    expected_keys = set(create_payload.keys())
    assert expected_keys == set(get_payload.keys()) == set(list_payload.keys()) == set(update_payload.keys()) == set(restore_payload.keys())
    for payload in [create_payload, get_payload, list_payload, update_payload, restore_payload]:
        assert "tag_ids" in payload
        assert "tags" in payload
        assert "attached_citation_ids" in payload
        assert "citation_ids" in payload
        assert payload["citation_ids"] == payload["attached_citation_ids"]


def test_document_tag_endpoints_support_add_replace_remove_and_noop_duplicates(monkeypatch):
    _app, repo, editor, _research_entities = _build_app(monkeypatch)
    request = _request()

    additive = asyncio.run(editor.assign_doc_tags(request, DOC_ID, editor.DocumentTagsWrite(tag_ids=[TAG_ALPHA, TAG_BETA, TAG_ALPHA])))
    assert [tag["id"] for tag in additive] == [TAG_ALPHA, TAG_BETA]
    assert repo.document_tags == {(DOC_ID, TAG_ALPHA), (DOC_ID, TAG_BETA)}

    replaced = asyncio.run(editor.replace_doc_tags(request, DOC_ID, editor.DocumentTagsWrite(tag_ids=[TAG_BETA])))
    assert [tag["id"] for tag in replaced] == [TAG_BETA]

    removed = asyncio.run(editor.delete_doc_tag(request, DOC_ID, TAG_BETA))
    assert removed == {"ok": True, "doc_id": DOC_ID, "tag_id": TAG_BETA}
    assert repo.document_tags == set()


def test_document_tag_invalid_ownership_returns_403(monkeypatch):
    _app, _repo, editor, research_entities = _build_app(monkeypatch)
    request = _request()

    with pytest.raises(HTTPException) as create_excinfo:
        asyncio.run(editor.create_doc(request, editor.DocumentCreate(title="Bad", tag_ids=[TAG_FOREIGN])))
    with pytest.raises(HTTPException) as update_excinfo:
        asyncio.run(
            editor.update_doc(
                request,
                DOC_ID,
                editor.DocumentUpdate(
                    title="Bad",
                    content_delta={"ops": [{"insert": "x\n"}]},
                    content_html="<p>x</p>",
                    attached_citation_ids=[],
                    tag_ids=[TAG_FOREIGN],
                ),
            )
        )
    with pytest.raises(HTTPException) as assign_excinfo:
        asyncio.run(editor.assign_doc_tags(request, DOC_ID, editor.DocumentTagsWrite(tag_ids=[TAG_FOREIGN])))
    with pytest.raises(HTTPException) as replace_excinfo:
        asyncio.run(editor.replace_doc_tags(request, DOC_ID, editor.DocumentTagsWrite(tag_ids=[TAG_FOREIGN])))

    assert create_excinfo.value.status_code == 403
    assert update_excinfo.value.status_code == 403
    assert assign_excinfo.value.status_code == 403
    assert replace_excinfo.value.status_code == 403

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(research_entities.ensure_tags(USER_ID, tag_ids=[TAG_FOREIGN]))
    assert excinfo.value.status_code == 403

    with pytest.raises(HTTPException) as note_excinfo:
        asyncio.run(research_entities.replace_note_tag_links(USER_ID, "ffffffff-ffff-4fff-8fff-ffffffffffff", [TAG_FOREIGN]))
    assert note_excinfo.value.status_code == 403


def test_document_tag_schema_missing_returns_503(monkeypatch):
    _app, _repo, editor, _research_entities = _build_app(monkeypatch, repo=DocumentTagRepo(schema_missing=True))
    request = _request()

    with pytest.raises(HTTPException) as get_excinfo:
        asyncio.run(editor.get_doc(request, DOC_ID))
    with pytest.raises(HTTPException) as assign_excinfo:
        asyncio.run(editor.assign_doc_tags(request, DOC_ID, editor.DocumentTagsWrite(tag_ids=[TAG_ALPHA])))

    assert get_excinfo.value.status_code == 503
    assert assign_excinfo.value.status_code == 503
