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


def test_extension_unlock_permit_requires_auth(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    importlib.reload(main)
    client = TestClient(main.app)
    response = client.post("/api/extension/unlock-permit", json={})
    assert response.status_code == 401
