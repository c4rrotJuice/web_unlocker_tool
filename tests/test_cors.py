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


def _load_main(monkeypatch, *, env="prod", cors_origins="https://app.writior.com,https://web-unlocker-tool.onrender.com"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", env)
    monkeypatch.setenv("CORS_ORIGINS", cors_origins)

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
async def test_cors_preflight_allows_allowlisted_origin(monkeypatch):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.options(
            "/api/public-config",
            headers={
                "Origin": "https://app.writior.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://app.writior.com"


@pytest.mark.anyio
async def test_cors_disallows_non_allowlisted_origin(monkeypatch):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.options(
            "/api/public-config",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 400
    assert response.headers.get("access-control-allow-origin") is None


def test_prod_rejects_wildcard_cors(monkeypatch):
    with pytest.raises(RuntimeError, match="cannot contain '\\*'"):
        _load_main(monkeypatch, cors_origins="*")
