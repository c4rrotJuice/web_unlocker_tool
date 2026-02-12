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
    def __init__(self, user_id: str, account_type: str):
        self.user_id = user_id
        self.account_type = account_type

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        return self

    def single(self):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return SimpleNamespace(
            data={"name": "T", "account_type": self.account_type, "daily_limit": 5}
        )


class DummyClient:
    def __init__(self, user_id: str, account_type: str):
        self.auth = DummyAuth(user_id)
        self.user_id = user_id
        self.account_type = account_type

    def table(self, *args, **kwargs):
        return DummyTable(self.user_id, self.account_type)


def _build_app(monkeypatch, account_type="pro"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(
        supabase,
        "create_client",
        lambda url, key: DummyClient("user-1", account_type),
    )

    from app import main

    importlib.reload(main)
    return main.app


def test_editor_allows_authenticated_cookie_user(monkeypatch):
    app = _build_app(monkeypatch)
    client = TestClient(app)

    response = client.get(
        "/editor",
        cookies={"wu_access_token": "good-token"},
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Research Editor" in response.text


def test_editor_redirects_to_auth_without_token(monkeypatch):
    app = _build_app(monkeypatch)
    client = TestClient(app)

    response = client.get("/editor", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/static/auth.html"


def test_editor_redirects_free_tier_to_pricing(monkeypatch):
    app = _build_app(monkeypatch, account_type="free")
    client = TestClient(app)

    response = client.get(
        "/editor",
        cookies={"wu_access_token": "good-token"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/static/pricing.html"
