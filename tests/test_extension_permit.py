import importlib
from uuid import uuid4

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
    return main


def test_extension_unlock_permit_rejects_missing_anon_id(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post("/api/extension/unlock-permit", json={})
    assert response.status_code == 422
    assert response.json()["detail"] == "X-Extension-Anon-Id must be a valid UUID."


def test_extension_unlock_permit_rejects_invalid_anon_id(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post(
        "/api/extension/unlock-permit",
        json={},
        headers={"X-Extension-Anon-Id": "not-a-uuid"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "X-Extension-Anon-Id must be a valid UUID."


def test_extension_unlock_permit_allows_anon_weekly_usage(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)
    anon_id = str(uuid4())
    headers = {"X-Extension-Anon-Id": anon_id, "X-Forwarded-For": "203.0.113.10"}

    for remaining in [4, 3, 2, 1, 0]:
        response = client.post("/api/extension/unlock-permit", json={}, headers=headers)
        assert response.status_code == 200
        assert response.json()["allowed"] is True
        assert response.json()["account_type"] == "anonymous"
        assert response.json()["remaining"] == remaining

    denied = client.post("/api/extension/unlock-permit", json={}, headers=headers)
    assert denied.status_code == 200
    assert denied.json()["allowed"] is False
    assert denied.json()["remaining"] == 0


def test_extension_unlock_permit_persists_identity_across_restart_simulation(monkeypatch):
    main = _build_app(monkeypatch)
    anon_id = str(uuid4())
    headers = {"X-Extension-Anon-Id": anon_id, "X-Forwarded-For": "198.51.100.50"}

    client_a = TestClient(main.app)
    first = client_a.post("/api/extension/unlock-permit", json={}, headers=headers)
    second = client_a.post("/api/extension/unlock-permit", json={}, headers=headers)

    client_b = TestClient(main.app)
    third = client_b.post("/api/extension/unlock-permit", json={}, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200
    assert first.json()["remaining"] == 4
    assert second.json()["remaining"] == 3
    assert third.json()["remaining"] == 2


def test_extension_unlock_permit_prevents_ip_rotation_of_anon_id(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)
    same_ip = "203.0.113.33"

    first = client.post(
        "/api/extension/unlock-permit",
        json={},
        headers={"X-Extension-Anon-Id": str(uuid4()), "X-Forwarded-For": same_ip},
    )
    assert first.status_code == 200

    rotated = client.post(
        "/api/extension/unlock-permit",
        json={},
        headers={"X-Extension-Anon-Id": str(uuid4()), "X-Forwarded-For": same_ip},
    )
    assert rotated.status_code == 429
    assert rotated.json()["detail"] == "Anonymous identity mismatch for this IP."
