import importlib

import supabase
from fastapi.testclient import TestClient

from app.services.ui_messages import is_valid_unlock_transition, map_error_payload


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


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    importlib.reload(main)
    return main


def test_legacy_login_routes_redirect_to_auth(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    for route in ("/login", "/signin", "/auth/login"):
        response = client.get(route, follow_redirects=False)
        assert response.status_code in (302, 307)
        assert response.headers["location"] == "/auth"


def test_static_auth_page_redirects_to_canonical_auth():
    with open("app/static/auth.html", "r", encoding="utf-8") as f:
        body = f.read()

    assert 'url=/auth' in body
    assert "window.location.replace('/auth'" in body


def test_error_mapping_and_unlock_lifecycle_transitions():
    mapped = map_error_payload({"error": {"code": "TOKEN_EXPIRED"}})
    assert mapped.type == "error"
    assert mapped.redirect_to == "/auth"
    assert "session expired" in mapped.message.lower()

    assert is_valid_unlock_transition(None, "UNLOCK_STARTED") is True
    assert is_valid_unlock_transition("UNLOCK_STARTED", "FETCHING_CONTENT") is True
    assert is_valid_unlock_transition("FETCHING_CONTENT", "CLEANING_CONTENT") is True
    assert is_valid_unlock_transition("CLEANING_CONTENT", "COMPLETE") is True
    assert is_valid_unlock_transition("UNLOCK_STARTED", "COMPLETE") is False
