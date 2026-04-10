from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest
import supabase

from app.core.config import RateLimitSettings, Settings, get_settings
from app.modules.extension.schemas import HandoffExchangeRequest
from app.modules.extension.service import ExtensionService
from app.modules.identity.schemas import SignupRequest
from app.modules.identity.service import IdentityService


class FakeIdentityRepository:
    async def fetch_profile(self, user_id: str, access_token: str):
        return {"display_name": "User One", "use_case": "research"}

    async def fetch_preferences(self, user_id: str, access_token: str):
        return {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
            "sidebar_auto_hide": False,
        }

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return {
            "tier": "standard",
            "status": "active",
            "paid_until": "2099-01-01T00:00:00Z",
            "auto_renew": True,
            "source": "paddle",
        }

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        return True


class FakeExtensionRepository:
    def __init__(self):
        self.handoff_codes = {
            "handoff-1": {
                "id": "1",
                "code": "handoff-1",
                "user_id": "user-1",
                "redirect_path": "/editor",
                "session_payload": {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "expires_in": 300,
                    "token_type": "bearer",
                },
                "expires_at": "2099-01-01T00:00:00+00:00",
                "used_at": None,
            }
        }

    async def get_handoff_code(self, *, code):
        record = self.handoff_codes.get(code)
        return dict(record) if record else None

    async def consume_handoff_code(self, *, record_id, used_at):
        record = self.handoff_codes["handoff-1"]
        if str(record["id"]) != str(record_id) or record.get("used_at") is not None:
            return None
        record["used_at"] = used_at
        return dict(record)

    async def mark_handoff_attempt_exchanged(self, *, handoff_code, exchanged_at):
        record = self.handoff_codes["handoff-1"]
        if record.get("code") == handoff_code:
            record["exchanged_at"] = exchanged_at

    async def clear_handoff_session_payload(self, *, record_id):
        return None

    async def invalidate_handoff_code(self, *, record_id, used_at):
        record = self.handoff_codes["handoff-1"]
        if str(record["id"]) == str(record_id):
            record["used_at"] = used_at

    async def delete_expired_handoff_codes(self, *, cleanup_grace_window_minutes: int = 10):
        return 0

    async def delete_expired_handoff_attempts(self, *, cleanup_grace_window_minutes: int = 10):
        return 0

    async def hit_auth_rate_limit(self, *, scope, identity, limit, window_seconds):
        return True, max(limit - 1, 0)

    async def record_revoked_access_token(self, *, access_token, user_id, expires_at):
        return None


class FakeRateLimiter:
    async def hit(self, _key, *, limit, window_seconds):
        return True, max(limit - 1, 0)


class FakeAuthClient:
    class _Auth:
        def get_user(self, token):
            return SimpleNamespace(user=SimpleNamespace(id="user-1", email="user@example.com"))

        def refresh_session(self, refresh_token):
            session = SimpleNamespace(
                access_token="refreshed-access",
                refresh_token=refresh_token,
                expires_in=300,
                token_type="bearer",
            )
            return SimpleNamespace(session=session)

    def __init__(self):
        self.auth = self._Auth()


def _base_settings(**overrides) -> Settings:
    settings = Settings(
        env="test",
        supabase_url="http://example.com",
        supabase_anon_key="anon",
        supabase_service_role_key="service",
        paddle_webhook_secret=None,
        paddle_api_key=None,
        paddle_client_side_token=None,
        paddle_api_base_url="https://api.paddle.com",
        paddle_environment="live",
        paddle_standard_monthly_price_id=None,
        paddle_standard_yearly_price_id=None,
        paddle_pro_monthly_price_id=None,
        paddle_pro_yearly_price_id=None,
        migration_pack_dir=Path("writior_migration_pack"),
        schema_contract_source="writior_migration_pack",
        enable_docs=False,
        canonical_app_origin="https://app.writior.com",
        cors_origins=("https://app.writior.com",),
        trusted_proxy_cidrs=(),
        trusted_proxy_nets=(),
        allow_proxy_headers=False,
        security_hsts_enabled=True,
        auth_handoff_ttl_seconds=60,
        extension_idempotency_ttl_seconds=900,
        rate_limits=RateLimitSettings(
            anonymous_public_limit=60,
            anonymous_public_window_seconds=60,
            authenticated_read_limit=120,
            authenticated_read_window_seconds=60,
            auth_sensitive_limit=20,
            auth_sensitive_window_seconds=60,
            future_write_heavy_limit=30,
            future_write_heavy_window_seconds=60,
        ),
    )
    return settings.__class__(**{**settings.__dict__, **overrides})


def test_app_modules_import_without_constructing_supabase_clients(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")

    def boom(*_args, **_kwargs):
        raise AssertionError("create_client should not run during module import")

    monkeypatch.setattr(supabase, "create_client", boom)

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main
    from app.modules.extension import routes as extension_routes
    from app.modules.identity import routes as identity_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    extension_routes = importlib.reload(extension_routes)
    identity_routes = importlib.reload(identity_routes)

    assert main.app is not None
    assert extension_routes.service is not None
    assert identity_routes.service is not None


@pytest.mark.anyio
async def test_identity_service_builds_admin_client_lazily(monkeypatch):
    created = []

    class LazyAuthClient:
        def __init__(self):
            self.auth = SimpleNamespace(
                sign_up=lambda payload: SimpleNamespace(user=SimpleNamespace(id="user-1"), session=None)
            )

    def fake_create_client(url, key):
        created.append((url, key))
        return LazyAuthClient()

    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setattr(supabase, "create_client", fake_create_client)

    import app.core.config as core_config
    import app.modules.identity.service as identity_service_module

    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    importlib.reload(identity_service_module)

    service = IdentityService(repository=FakeIdentityRepository())
    await service.signup(SignupRequest(email="test@example.com", password="password123", display_name="Test User", use_case="research"))

    assert created == [("http://example.com", "service")]


@pytest.mark.anyio
async def test_extension_service_builds_auth_client_lazily(monkeypatch):
    created = []

    class LazyAuthClient:
        class _Auth:
            def get_user(self, token):
                return SimpleNamespace(user=SimpleNamespace(id="user-1", email="user@example.com"))

            def refresh_session(self, refresh_token):
                session = SimpleNamespace(
                    access_token="refreshed-access",
                    refresh_token=refresh_token,
                    expires_in=300,
                    token_type="bearer",
                )
                return SimpleNamespace(session=session)

        def __init__(self):
            self.auth = self._Auth()

    def fake_create_client(url, key):
        created.append((url, key))
        return LazyAuthClient()

    import app.modules.extension.service as extension_service_module

    monkeypatch.setattr(extension_service_module, "create_client", fake_create_client)

    service = ExtensionService(
        settings=_base_settings(),
        repository=FakeExtensionRepository(),
        unlock_service=SimpleNamespace(),
        identity_service=SimpleNamespace(),
        taxonomy_service=SimpleNamespace(),
        citations_service=SimpleNamespace(),
        quotes_service=SimpleNamespace(),
        notes_service=SimpleNamespace(),
        workspace_service=SimpleNamespace(),
        graph_service=SimpleNamespace(),
    )
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(rate_limiter=FakeRateLimiter())),
        client=SimpleNamespace(host="127.0.0.1"),
    )

    payload = HandoffExchangeRequest(code="handoff-1")
    response = await service.exchange_handoff(request, payload)

    assert created == [("http://example.com", "anon")]
    assert response["ok"] is True
    assert response["data"]["session"]["access_token"] == "access-token"


@pytest.mark.anyio
async def test_missing_supabase_settings_fail_explicitly_for_lazy_clients(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")

    import app.core.config as core_config

    core_config.get_settings.cache_clear()

    identity = IdentityService(repository=FakeIdentityRepository())
    with pytest.raises(RuntimeError, match="Supabase admin settings are incomplete"):
        await identity.signup(SignupRequest(email="test@example.com", password="password123", display_name="Test User", use_case="research"))

    service = ExtensionService(
        settings=_base_settings(supabase_url=None, supabase_anon_key=None),
        repository=FakeExtensionRepository(),
        unlock_service=SimpleNamespace(),
        identity_service=SimpleNamespace(),
        taxonomy_service=SimpleNamespace(),
        citations_service=SimpleNamespace(),
        quotes_service=SimpleNamespace(),
        notes_service=SimpleNamespace(),
        workspace_service=SimpleNamespace(),
        graph_service=SimpleNamespace(),
    )

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(rate_limiter=FakeRateLimiter())),
        client=SimpleNamespace(host="127.0.0.1"),
    )
    with pytest.raises(RuntimeError, match="Supabase auth settings are incomplete"):
        await service.exchange_handoff(request, HandoffExchangeRequest(code="handoff-1"))
