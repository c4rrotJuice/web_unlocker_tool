import importlib
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


class DummySignupAuth:
    def __init__(self):
        self.last_signup_payload = None
        self.last_admin_update = None
        self.admin = self

    def sign_up(self, payload):
        self.last_signup_payload = payload
        user = SimpleNamespace(id="generated-user-id")
        return SimpleNamespace(user=user)

    def update_user_by_id(self, user_id, payload):
        self.last_admin_update = (user_id, payload)
        return SimpleNamespace(user=SimpleNamespace(id=user_id))


class DummySignupClient:
    def __init__(self):
        self.auth = DummySignupAuth()
        self.upsert_payload = None
        self.upsert_on_conflict = None

    def table(self, table_name):
        self.table_name = table_name
        return self

    def upsert(self, payload, on_conflict=None):
        self.upsert_payload = payload
        self.upsert_on_conflict = on_conflict
        return self

    def execute(self):
        return SimpleNamespace(data=[self.upsert_payload])

    # startup sanity call support in app.main
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self


def _build_app(monkeypatch):
    dummy = DummySignupClient()
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: dummy)

    from app import main
    from app.services import authentication

    importlib.reload(main)
    monkeypatch.setattr(authentication, "supabase", dummy)
    return main.app, dummy


def test_signup_with_user_id_updates_auth_metadata_and_user_meta(monkeypatch):
    app, dummy = _build_app(monkeypatch)
    client = TestClient(app)

    payload = {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "password": "password123",
        "use_case": "research",
        "user_id": "existing-user-id",
    }

    response = client.post("/api/signup", json=payload)

    assert response.status_code == 200
    assert dummy.auth.last_signup_payload is None
    assert dummy.auth.last_admin_update == (
        "existing-user-id",
        {"user_metadata": {"name": "Jane Doe", "use_case": "research"}},
    )
    assert dummy.table_name == "user_meta"
    assert dummy.upsert_on_conflict == "user_id"
    assert dummy.upsert_payload["user_id"] == "existing-user-id"
    assert dummy.upsert_payload["name"] == "Jane Doe"
    assert dummy.upsert_payload["use_case"] == "research"


def test_signup_without_user_id_creates_user_with_metadata_and_upserts(monkeypatch):
    app, dummy = _build_app(monkeypatch)
    client = TestClient(app)

    payload = {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "password": "password123",
        "use_case": "student",
    }

    response = client.post("/api/signup", json=payload)

    assert response.status_code == 200
    assert dummy.auth.last_signup_payload == {
        "email": "jane@example.com",
        "password": "password123",
        "options": {"data": {"name": "Jane Doe", "use_case": "student"}},
    }
    assert dummy.auth.last_admin_update == (
        "generated-user-id",
        {"user_metadata": {"name": "Jane Doe", "use_case": "student"}},
    )
    assert dummy.upsert_payload["user_id"] == "generated-user-id"


def test_signup_without_user_id_requires_email_and_password(monkeypatch):
    app, _dummy = _build_app(monkeypatch)
    client = TestClient(app)

    payload = {
        "name": "Jane Doe",
        "use_case": "research",
    }

    response = client.post("/api/signup", json=payload)

    assert response.status_code == 422
    assert "email and password are required" in response.json()["detail"]
