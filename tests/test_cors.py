import importlib

import pytest
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


def _load_main(monkeypatch, *, env="prod", cors_origins="https://web-unlocker-tool.onrender.com"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("ENV", env)
    if cors_origins is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", cors_origins)

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    return importlib.reload(main)


def test_cors_preflight_allows_allowlisted_origin(monkeypatch):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    response = client.options(
        "/api/public-config",
        headers={
            "Origin": "https://web-unlocker-tool.onrender.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "https://web-unlocker-tool.onrender.com"


def test_cors_disallows_non_allowlisted_origin(monkeypatch):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    response = client.options(
        "/api/public-config",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert response.headers.get("access-control-allow-origin") is None


def test_cors_credentials_header_only_for_allowlisted_origin(monkeypatch):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    allowed = client.options(
        "/api/public-config",
        headers={
            "Origin": "https://web-unlocker-tool.onrender.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    denied = client.options(
        "/api/public-config",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert allowed.headers.get("access-control-allow-credentials") == "true"
    assert allowed.headers.get("access-control-allow-origin") == "https://web-unlocker-tool.onrender.com"
    assert denied.headers.get("access-control-allow-origin") is None
    assert denied.headers.get("access-control-allow-credentials") == "true"


def test_prod_requires_explicit_non_wildcard_cors_origins(monkeypatch):
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        _load_main(monkeypatch, env="prod", cors_origins=None)

    with pytest.raises(RuntimeError, match=r"cannot contain '\*'"):
        _load_main(monkeypatch, env="prod", cors_origins="*")
