import importlib
import asyncio
from types import SimpleNamespace

import supabase


DOC_ID = "11111111-1111-4111-8111-111111111111"


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, token):
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyTable:
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
        return SimpleNamespace(data={"name": "Tier User", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth("user-1")
        self.account_type = account_type

    def table(self, *args, **kwargs):
        return DummyTable(self.account_type)


class DummyResp:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class DummyRepo:
    async def get(self, resource, *args, **kwargs):
        if resource == "documents":
            return DummyResp(200, [{"id": DOC_ID, "title": "Doc", "content_delta": {"ops": [{"insert": "x\n"}]}, "project_id": None, "created_at": "2020-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}])
        if resource == "document_citations":
            return DummyResp(200, [])
        if resource == "document_tags":
            return DummyResp(200, [])
        if resource == "citations":
            return DummyResp(200, [])
        return DummyResp(200, [])

    async def post(self, resource, *args, **kwargs):
        if resource == "document_citations":
            return DummyResp(201, [])
        if resource == "document_tags":
            return DummyResp(201, [])
        return DummyResp(201, [{"id": DOC_ID, "title": "Untitled", "content_delta": {"ops": [{"insert": "\n"}]}, "project_id": None, "updated_at": "2026-01-01T00:00:00+00:00"}])

    async def patch(self, *args, **kwargs):
        return DummyResp(200, [{"id": DOC_ID, "project_id": None}])

    async def delete(self, resource, *args, **kwargs):
        if resource == "document_citations":
            return DummyResp(204, [])
        return DummyResp(200, [{"id": DOC_ID}])

    async def rpc(self, function_name, **kwargs):
        payload = kwargs.get("json") or {}
        if function_name == "replace_document_citations_atomic":
            return DummyResp(200, payload.get("p_citation_ids", []))
        if function_name == "replace_document_tags_atomic":
            return DummyResp(200, payload.get("p_tag_ids", []))
        return DummyResp(404, {"message": f'function "{function_name}" does not exist'})

    def headers(self, *args, **kwargs):
        return {}


def _build_app(monkeypatch, account_type="pro"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(account_type))

    from app import main

    importlib.reload(main)

    redis_data = {}

    async def redis_get(key):
        return redis_data.get(key, 0)

    async def redis_set(key, value, ttl_seconds=None):
        redis_data[key] = value
        return True

    async def redis_incr(key):
        redis_data[key] = int(redis_data.get(key, 0)) + 1
        return redis_data[key]

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire

    from app.routes import editor
    from app.services import research_entities

    repo = DummyRepo()
    editor.supabase_repo = repo
    research_entities.supabase_repo = repo
    return main.app


def _request(*, account_type="pro", user_id="user-1"):
    async def redis_get(_key):
        return 0

    async def redis_set(_key, _value, ttl_seconds=None):
        return True

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    return SimpleNamespace(
        state=SimpleNamespace(user_id=user_id, account_type=account_type),
        app=SimpleNamespace(state=SimpleNamespace(redis_get=redis_get, redis_set=redis_set, redis_incr=redis_incr, redis_expire=redis_expire)),
    )


def test_pro_doc_not_archived_and_can_delete_and_zip(monkeypatch):
    _build_app(monkeypatch, account_type="pro")
    from app.routes import editor

    get_res = asyncio.run(editor.get_doc(_request(account_type="pro"), DOC_ID))
    assert get_res["archived"] is False

    delete_res = asyncio.run(editor.delete_doc(_request(account_type="pro"), DOC_ID))
    assert delete_res["deleted"] is True

    zip_res = asyncio.run(editor.export_docs_zip(_request(account_type="pro")))
    assert zip_res.headers["content-type"].startswith("application/zip")


def test_lower_tier_cannot_use_citation_templates(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import citations

    try:
        asyncio.run(citations.list_citation_templates(_request(account_type="standard")))
        raise AssertionError("expected HTTPException")
    except Exception as exc:
        assert exc.status_code == 403
        assert exc.detail["code"] == "CITATION_TEMPLATE_PRO_ONLY"
