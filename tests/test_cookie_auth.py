import importlib
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email


class DummyAuth:
    def get_user(self, token):
        if token == "good-cookie":
            return SimpleNamespace(user=DummyUser("cookie-user"))
        if token == "good-header":
            return SimpleNamespace(user=DummyUser("header-user"))
        raise Exception("invalid token")

    def sign_in_with_password(self, payload):
        session = SimpleNamespace(
            access_token="good-cookie",
            refresh_token="refresh-token",
            expires_in=3600,
        )
        return SimpleNamespace(user=DummyUser("cookie-user", payload["email"]), session=session)


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data={"name": "Test", "account_type": "free", "daily_limit": 5})

    def insert(self, *args, **kwargs):
        return self


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()

    def table(self, *args, **kwargs):
        return DummyTable()


class DummyRedis:
    async def __call__(self, *args, **kwargs):
        return None


def build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setattr(supabase, "create_client", lambda *args, **kwargs: DummyClient())

    from app import main

    importlib.reload(main)
    return main


def test_auth_me_requires_auth(monkeypatch):
    main = build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_login_sets_cookie_session(monkeypatch):
    main = build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post("/api/login", json={"email": "user@example.com", "password": "pass"})

    assert response.status_code == 200
    cookies = response.headers.get("set-cookie", "")
    assert "access_token=good-cookie" in cookies
    assert "refresh_token=refresh-token" in cookies
    assert "csrf_token=" in cookies
    assert "Path=/" in cookies


def test_invalid_header_does_not_override_valid_cookie(monkeypatch):
    main = build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.get(
        "/dashboard",
        cookies={"access_token": "good-cookie"},
        headers={"Authorization": "Bearer bad-token"},
    )

    assert response.status_code == 200


def test_csrf_required_for_unsafe_method(monkeypatch):
    main = build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post(
        "/api/auth/logout",
        cookies={"access_token": "good-cookie", "csrf_token": "csrf-good"},
    )
    assert response.status_code == 403

    response_ok = client.post(
        "/api/auth/logout",
        cookies={"access_token": "good-cookie", "csrf_token": "csrf-good"},
        headers={"X-CSRF-Token": "csrf-good"},
    )
    assert response_ok.status_code == 200
