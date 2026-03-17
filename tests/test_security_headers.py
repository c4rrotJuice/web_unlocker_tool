import importlib

import pytest
import supabase

from tests.conftest import async_test_client


class DummyAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": None})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()


EXPECTED_SECURITY_HEADERS = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
}


def _load_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "whsec_test")

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    return importlib.reload(main)


@pytest.mark.anyio
async def test_security_headers_added_to_success_response(monkeypatch):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.get("/api/public-config")

    assert response.status_code == 200
    for header, value in EXPECTED_SECURITY_HEADERS.items():
        assert response.headers.get(header) == value


@pytest.mark.anyio
async def test_security_headers_added_to_error_response(monkeypatch):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.get("/api/me")

    assert response.status_code == 401
    for header, value in EXPECTED_SECURITY_HEADERS.items():
        assert response.headers.get(header) == value
