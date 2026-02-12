import importlib

import supabase
from fastapi.testclient import TestClient


class DummyAuth:
    def get_user(self, token):
        return type("DummyUser", (), {"user": None})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def execute(self):
        return type("DummyExecute", (), {"data": []})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()

    def table(self, *args, **kwargs):
        return DummyTable()


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    importlib.reload(main)

    redis_data = {}

    async def redis_get(key):
        return redis_data.get(key, 0)

    async def redis_incr(key):
        redis_data[key] = int(redis_data.get(key, 0)) + 1
        return redis_data[key]

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    return main


def test_extension_unlock_permit_requires_anon_id_when_unauthenticated(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post("/api/extension/unlock-permit", json={})
    assert response.status_code == 400
    assert response.json()["reason"] == "anonymous_id_required"


def test_extension_unlock_permit_allows_anon_weekly_usage(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    headers = {"X-Extension-Anon-Id": "anon-user-123"}
    for _ in range(5):
        response = client.post("/api/extension/unlock-permit", headers=headers, json={})
        assert response.status_code == 200
        assert response.json()["allowed"] is True
        assert response.json()["account_type"] == "anonymous"

    denied = client.post("/api/extension/unlock-permit", headers=headers, json={})
    assert denied.status_code == 200
    assert denied.json()["allowed"] is False
    assert denied.json()["remaining"] == 0
