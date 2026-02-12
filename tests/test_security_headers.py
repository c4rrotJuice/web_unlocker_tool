import importlib

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


EXPECTED_SECURITY_HEADERS = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
}


def _load_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("CORS_ORIGINS", "https://web-unlocker-tool.onrender.com")

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    return importlib.reload(main)


def test_security_headers_added_to_success_response(monkeypatch):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    response = client.get("/api/public-config")

    assert response.status_code == 200
    for header, value in EXPECTED_SECURITY_HEADERS.items():
        assert response.headers.get(header) == value


def test_security_headers_added_to_unauthorized_response(monkeypatch):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    response = client.get("/api/me")

    assert response.status_code == 401
    for header, value in EXPECTED_SECURITY_HEADERS.items():
        assert response.headers.get(header) == value
