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


class DummyInsert:
    def execute(self):
        return SimpleNamespace(data=[{"id": 1}], error=None)


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

    def insert(self, *args, **kwargs):
        return DummyInsert()

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
    async def get(self, *args, **kwargs):
        return DummyResp(200, [{"title": "Doc", "content_delta": {"ops": [{"insert": "x\n"}]}, "citation_ids": [], "created_at": "2020-01-01T00:00:00+00:00"}])

    async def post(self, *args, **kwargs):
        return DummyResp(201, [{"id": "doc-1", "title": "Untitled", "content_delta": {"ops": [{"insert": "\n"}]}, "citation_ids": [], "updated_at": "2026-01-01T00:00:00+00:00"}])

    async def patch(self, *args, **kwargs):
        return DummyResp(200, [{"id": "doc-1"}])

    def headers(self, *args, **kwargs):
        return {}


def _build_app(monkeypatch, account_type="standard"):
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


def test_standard_unlock_permit_limited_to_15_per_day(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard")
    client = TestClient(app)
    headers = {"Authorization": "Bearer valid"}

    for _ in range(15):
        response = client.post("/api/extension/unlock-permit", json={}, headers=headers)
        assert response.status_code == 200
        assert response.json()["allowed"] is True
        assert response.json()["usage_period"] == "day"

    denied = client.post("/api/extension/unlock-permit", json={}, headers=headers)
    assert denied.status_code == 200
    assert denied.json()["allowed"] is False


def test_standard_doc_creation_blocked_at_16th(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    async def fake_count(*args, **kwargs):
        return 15

    monkeypatch.setattr(editor, "_count_docs_in_window", fake_count)

    client = TestClient(app)
    response = client.post("/api/docs", json={}, headers={"Authorization": "Bearer valid"})
    assert response.status_code == 403
    assert response.json()["detail"]["toast"] == "Document limit reached for this period. Upgrade to Pro for unlimited access."


def test_standard_archived_doc_blocks_edit_but_allows_export(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    async def fake_fetch_doc_core(*args, **kwargs):
        return {"created_at": "2020-01-01T00:00:00+00:00"}

    monkeypatch.setattr(editor, "_fetch_doc_core", fake_fetch_doc_core)

    client = TestClient(app)
    put_res = client.put(
        "/api/docs/doc-1",
        json={"title": "T", "content_delta": {"ops": [{"insert": "x"}]}, "content_html": "<p>x</p>", "citation_ids": []},
        headers={"Authorization": "Bearer valid"},
    )
    assert put_res.status_code == 403
    assert put_res.json()["detail"]["toast"] == "This document is archived. Upgrade to Pro to restore editing."

    export_res = client.post(
        "/api/docs/doc-1/export",
        json={"format": "docx", "style": "mla"},
        headers={"Authorization": "Bearer valid"},
    )
    assert export_res.status_code == 200
    assert export_res.json()["archived"] is True
    assert export_res.json()["format"] == "docx"
    assert export_res.json()["filename"].endswith(".docx")
    assert export_res.json()["file_content"]


def test_free_tier_export_blocks_docx(monkeypatch):
    app = _build_app(monkeypatch, account_type="free")
    client = TestClient(app)

    export_res = client.post(
        "/api/docs/doc-1/export",
        json={"format": "docx"},
        headers={"Authorization": "Bearer valid"},
    )

    assert export_res.status_code == 403
    assert export_res.json()["detail"]["code"] == "EXPORT_FORMAT_LOCKED"


def test_free_tier_export_pdf_returns_download_payload(monkeypatch):
    app = _build_app(monkeypatch, account_type="free")
    client = TestClient(app)

    export_res = client.post(
        "/api/docs/doc-1/export",
        json={"format": "pdf"},
        headers={"Authorization": "Bearer valid"},
    )

    assert export_res.status_code == 200
    payload = export_res.json()
    assert payload["format"] == "pdf"
    assert payload["filename"].endswith(".pdf")
    assert payload["media_type"] == "application/pdf"
    assert payload["file_content"]


def test_pro_unlock_permit_unlimited(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro")
    client = TestClient(app)
    headers = {"Authorization": "Bearer valid"}

    response = client.post("/api/extension/unlock-permit", json={}, headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["allowed"] is True
    assert payload["remaining"] == -1
    assert payload["usage_period"] == "unlimited"
