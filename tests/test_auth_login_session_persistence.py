import importlib
from types import SimpleNamespace

import pytest
import supabase

from tests.conftest import async_test_client


class DummyLoginAuth:
    def __init__(self):
        self.last_payload = None

    def sign_in_with_password(self, payload):
        self.last_payload = payload
        session = SimpleNamespace(access_token="access-123", refresh_token="refresh-456")
        user = SimpleNamespace(id="user-1", email=payload["email"])
        return SimpleNamespace(user=user, session=session)


class DummyAuthClient:
    def __init__(self):
        self.auth = DummyLoginAuth()

    def table(self, *args, **kwargs):
        return self

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=[])


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyAuthClient())

    from app import main
    from app.services import authentication

    importlib.reload(main)
    monkeypatch.setattr(authentication, "supabase", DummyAuthClient())
    return main.app


@pytest.mark.anyio
async def test_login_sets_cookie_and_returns_refresh_token(monkeypatch):
    app = _build_app(monkeypatch)
    async with async_test_client(app) as client:
        response = await client.post(
            "/api/login",
            json={"email": "user@example.com", "password": "password123"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"] == "access-123"
    assert body["refresh_token"] == "refresh-456"

    set_cookie = response.headers.get("set-cookie", "")
    assert "wu_access_token=access-123" in set_cookie
    assert "Path=/" in set_cookie
