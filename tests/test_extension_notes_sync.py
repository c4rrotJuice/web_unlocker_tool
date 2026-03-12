import importlib

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, _token):
        return type("DummyUserResponse", (), {"user": DummyUser(self.user_id)})


class DummyInsert:
    def execute(self):
        return type("DummyInsertResponse", (), {"data": [{"id": 1}]})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return type("DummyExecute", (), {"data": {"name": "Tester", "account_type": "standard", "daily_limit": 5}})


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else [{"id": "ok"}]

    def json(self):
        return self._payload


class FakeSupabaseRepo:
    def __init__(self):
        self.calls = []

    def headers(self, **kwargs):
        return {"x-test": "1", **({"prefer": kwargs.get("prefer")} if kwargs.get("prefer") else {})}

    async def post(self, resource, **kwargs):
        self.calls.append(("post", resource, kwargs))
        return FakeResponse(201, [{"id": "n"}])

    async def patch(self, resource, **kwargs):
        self.calls.append(("patch", resource, kwargs))
        return FakeResponse(200, [{"id": "n"}])

    async def delete(self, resource, **kwargs):
        self.calls.append(("delete", resource, kwargs))
        return FakeResponse(204, [])


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-notes"))

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
    return main


def test_notes_create_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Title",
        "note_body": "Body",
        "source_url": "https://example.com/a",
        "tags": ["43f2fbbf-2390-4ea3-bfc4-28ea0803aca7"],
    }

    response = client.post("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "post" and call[1] == "notes" for call in repo.calls)
    assert any(call[0] == "post" and call[1] == "note_note_tags" for call in repo.calls)


def test_notes_update_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Title2",
        "note_body": "Body2",
        "tags": [],
    }

    response = client.patch("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)


def test_notes_delete_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    response = client.delete(f"/api/notes/{note_id}", headers={"Authorization": "Bearer token"})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "delete" and call[1] == "notes" for call in repo.calls)
