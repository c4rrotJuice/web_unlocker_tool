import importlib

import supabase
from fastapi.testclient import TestClient

from app.routes.error_responses import safe_api_error_response, safe_html_error_response


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

    async def redis_get(_key):
        return 0

    async def redis_set(_key, _value, ttl_seconds=None):
        return True

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    return main



def test_safe_api_error_response_shape_hides_exception_text():
    response = safe_api_error_response(
        request=None,
        error_code="INTERNAL_ERROR",
        message="Request failed",
        exc=RuntimeError("provider said api_key=secret"),
    )

    assert response.status_code == 500
    payload = response.body.decode("utf-8")
    assert '"error_code":"INTERNAL_ERROR"' in payload
    assert '"message":"Request failed"' in payload
    assert '"request_id":"' in payload
    assert "provider said api_key=secret" not in payload



def test_safe_html_error_response_shape_hides_exception_text():
    response = safe_html_error_response(
        request=None,
        error_code="HTML_RENDER_FAILED",
        message="Unable to load page right now.",
        exc=RuntimeError("upstream timeout stack trace text"),
    )

    assert response.status_code == 500
    body = response.body.decode("utf-8")
    assert 'data-error-code="HTML_RENDER_FAILED"' in body
    assert "Unable to load page right now." in body
    assert "request_id:" in body
    assert "upstream timeout stack trace text" not in body



def test_fetch_and_clean_page_uses_safe_html_error_response(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    async def fake_check_login(*args, **kwargs):
        return {"user_id": "user-1", "use_cloudscraper": False}

    async def boom_fetch_and_clean_page(*args, **kwargs):
        raise RuntimeError("RAW_PROVIDER_MESSAGE token=abc")

    monkeypatch.setattr(main.render, "check_login", fake_check_login)
    monkeypatch.setattr(main.render, "fetch_and_clean_page", boom_fetch_and_clean_page)

    response = client.post(
        "/fetch_and_clean_page",
        json={"url": "https://example.com", "unlock": True},
    )

    assert response.status_code == 500
    assert "Unable to load page right now." in response.text
    assert "request_id:" in response.text
    assert "RAW_PROVIDER_MESSAGE token=abc" not in response.text
