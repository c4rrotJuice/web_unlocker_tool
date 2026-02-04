import importlib

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self._user_id = user_id

    def get_user(self, token):
        return type("DummyUserResponse", (), {"user": DummyUser(self._user_id)})


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
        return type("DummySelectResponse", (), {"data": {}})


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


def test_create_handoff_success(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-1"))

    from app import main

    importlib.reload(main)
    client = TestClient(main.app)
    response = client.post(
        "/api/auth/handoff",
        json={"refresh_token": "refresh-token", "redirect_path": "/editor"},
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data.get("code"), str)
    assert data["code"]
    assert data["redirect_path"] == "/editor"
