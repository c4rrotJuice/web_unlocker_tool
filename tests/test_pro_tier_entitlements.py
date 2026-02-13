import importlib
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


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
            return DummyResp(200, [{"id": "doc-1", "title": "Doc", "content_delta": {"ops": [{"insert": "x\n"}]}, "citation_ids": [], "created_at": "2020-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}])
        if resource == "citations":
            return DummyResp(200, [])
        return DummyResp(200, [])

    async def post(self, *args, **kwargs):
        return DummyResp(201, [{"id": "doc-1", "title": "Untitled", "content_delta": {"ops": [{"insert": "\n"}]}, "citation_ids": [], "updated_at": "2026-01-01T00:00:00+00:00"}])

    async def patch(self, *args, **kwargs):
        return DummyResp(200, [{"id": "doc-1"}])

    async def delete(self, *args, **kwargs):
        return DummyResp(200, [{"id": "doc-1"}])

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

    editor.supabase_repo = DummyRepo()
    return main.app


def test_pro_doc_not_archived_and_can_delete_and_zip(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro")
    client = TestClient(app)
    headers = {"Authorization": "Bearer valid"}

    get_res = client.get("/api/docs/doc-1", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["archived"] is False

    delete_res = client.delete("/api/docs/doc-1", headers=headers)
    assert delete_res.status_code == 200
    assert delete_res.json()["deleted"] is True

    zip_res = client.get("/api/docs/export/zip", headers=headers)
    assert zip_res.status_code == 200
    assert zip_res.headers["content-type"].startswith("application/zip")


def test_lower_tier_cannot_use_citation_templates(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard")
    client = TestClient(app)
    headers = {"Authorization": "Bearer valid"}

    res = client.get("/api/citation-templates", headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "CITATION_TEMPLATE_PRO_ONLY"
