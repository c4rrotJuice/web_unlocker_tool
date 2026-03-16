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


def _load_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")

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
async def test_request_id_is_returned_and_logged(monkeypatch, caplog):
    main = _load_main(monkeypatch)

    request_id = "req-test-123"
    async with async_test_client(main.app) as client:
        response = await client.get("/api/public-config", headers={"X-Request-Id": request_id})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == request_id

    assert any(
        record.message == "request.completed"
        and getattr(record, "request_id", None) == request_id
        and getattr(record, "route", None) == "/api/public-config"
        and getattr(record, "status", None) == 200
        for record in caplog.records
    )
