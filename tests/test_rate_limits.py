import importlib

import pytest
import supabase

from tests.conftest import async_test_client
from tests.test_auth_core import DummyClient, ValidAuth


class FakeSharedRateLimitRepository:
    calls = []
    decisions = []

    def __init__(self, *, base_url, service_role_key):
        self.base_url = base_url
        self.service_role_key = service_role_key

    def headers(self, **_kwargs):
        return {}

    async def rpc(self, function_name, *, json=None, headers=None):
        assert function_name == "hit_auth_rate_limit"
        self.__class__.calls.append(dict(json or {}))
        allowed, aux = self.__class__.decisions.pop(0) if self.__class__.decisions else (True, 0)
        return type(
            "Response",
            (),
            {
                "json": lambda _self: [
                    {
                        "allowed": allowed,
                        "retry_after": aux,
                        "remaining": aux if allowed else 0,
                    }
                ]
            },
        )()


def _load_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(ValidAuth()))

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.core.security as core_security
    from app import main
    from app.modules.identity import routes as identity_routes

    importlib.reload(core_config)
    importlib.reload(core_auth)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    monkeypatch.setattr(core_security, "SupabaseRestRepository", FakeSharedRateLimitRepository)
    identity_routes = importlib.reload(identity_routes)
    main = importlib.reload(main)
    return main.app, identity_routes


@pytest.mark.anyio
async def test_signup_throttle_returns_consistent_rate_limit_response(monkeypatch):
    FakeSharedRateLimitRepository.calls = []
    FakeSharedRateLimitRepository.decisions = [(False, 37)]
    app, _identity_routes = _load_app(monkeypatch)

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/auth/signup",
            json={"email": "user@example.com", "password": "password123", "display_name": "User"},
        )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "37"
    assert response.json()["error"]["code"] == "rate_limit_exceeded"
    assert FakeSharedRateLimitRepository.calls[0]["p_scope"] == "auth_sensitive:signup"


@pytest.mark.anyio
async def test_signup_uses_shared_ip_and_email_buckets_before_creating_account(monkeypatch):
    FakeSharedRateLimitRepository.calls = []
    FakeSharedRateLimitRepository.decisions = [(True, 19), (True, 18)]
    app, identity_routes = _load_app(monkeypatch)
    called = {}

    async def fake_signup(payload):
        called["email"] = payload.email
        return {"ok": True, "data": {"user_id": "user-1"}, "meta": {}, "error": None}

    identity_routes.service.signup = fake_signup

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/auth/signup",
            json={"email": "USER@EXAMPLE.COM", "password": "password123", "display_name": "User"},
        )

    assert response.status_code == 200
    assert called["email"] == "USER@example.com"
    assert [call["p_scope"] for call in FakeSharedRateLimitRepository.calls] == [
        "auth_sensitive:signup",
        "auth_sensitive:signup_email",
    ]
    assert FakeSharedRateLimitRepository.calls[1]["p_identity"] == "email:user@example.com"
