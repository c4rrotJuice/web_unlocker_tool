import importlib
from urllib.parse import quote

import pytest
import supabase

from app.core.security import SESSION_COOKIE_NAME
from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1")})


class InvalidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": None})


class DummyClient:
    def __init__(self, auth):
        self.auth = auth


def _load_main(monkeypatch, *, auth_impl):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(auth_impl))

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    return importlib.reload(main)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "path",
    [
        "/dashboard",
        "/projects",
        "/projects/project-123",
        "/research?tab=quotes&selected=quote-1",
        "/editor?document_id=doc-1",
        "/insights",
    ],
)
async def test_protected_shell_pages_redirect_unauthenticated_requests(monkeypatch, path):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    encoded_next = quote(path, safe="")

    async with async_test_client(main.app) as client:
        response = await client.get(path, follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == f"/auth?next={encoded_next}"


@pytest.mark.anyio
async def test_protected_shell_pages_accept_verified_session_cookie(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())

    async with async_test_client(main.app) as client:
        session_response = await client.post("/api/auth/session", json={"access_token": "valid-token"})
        assert session_response.status_code == 200
        response = await client.get("/dashboard", follow_redirects=False)

    assert response.status_code == 200
    assert "<title>Dashboard · Writior</title>" in response.text


@pytest.mark.anyio
async def test_protected_shell_pages_reject_legacy_cookie_only_auth(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=InvalidAuth())

    async with async_test_client(main.app) as client:
        client.cookies.set(SESSION_COOKIE_NAME, "invalid-token")
        response = await client.get("/dashboard", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/auth?next=%2Fdashboard"
    assert SESSION_COOKIE_NAME in response.headers.get("set-cookie", "")
    assert "Max-Age=0" in response.headers.get("set-cookie", "")
