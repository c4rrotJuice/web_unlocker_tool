import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.auth import RequestAuthContext, is_access_token_revoked
from app.core.config import RateLimitSettings, Settings
from app.modules.extension.schemas import AuthAttemptCreateRequest, HandoffRefreshRequest, HandoffIssueRequest
from app.modules.extension.service import ExtensionAccessContext
from tests.test_extension_auth_attempt_service import _request, _service


def _access(access_token: str | None = "access-token") -> ExtensionAccessContext:
    return ExtensionAccessContext(
        auth_context=RequestAuthContext(
            authenticated=True,
            user_id="user-1",
            supabase_subject="user-1",
            email="user@example.com",
            access_token=access_token,
            token_claims={"sub": "user-1"},
        ),
        account_state=SimpleNamespace(profile=SimpleNamespace(), entitlement=SimpleNamespace()),
        capability_state=SimpleNamespace(tier="standard"),
    )


class RevokingAuthClient:
    def __init__(self):
        self.revoked = []
        self.auth = SimpleNamespace(admin=SimpleNamespace(sign_out=self.sign_out))

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        self.revoked.append({"jwt": jwt, "scope": scope})


class RefreshRevokingAuthClient:
    def __init__(self):
        self.revoked = False
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(sign_out=self.sign_out),
            get_user=self.get_user,
            refresh_session=self.refresh_session,
        )

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        self.revoked = True

    def get_user(self, token: str):
        return SimpleNamespace(user=SimpleNamespace(id="user-1")) if token else SimpleNamespace(user=None)

    def refresh_session(self, refresh_token: str):
        if self.revoked:
            raise RuntimeError("refresh token revoked")
        return SimpleNamespace(
            session=SimpleNamespace(
                access_token="new-access",
                refresh_token=refresh_token,
                expires_in=300,
                token_type="bearer",
            )
        )


class FailingRevokingAuthClient:
    def __init__(self):
        self.auth = SimpleNamespace(admin=SimpleNamespace(sign_out=self.sign_out))

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        raise RuntimeError("provider unavailable")


@pytest.mark.anyio
async def test_extension_handoff_logout_revokes_supabase_session_globally():
    service = _service()
    auth_client = RevokingAuthClient()
    service._auth_client = auth_client

    result = await service.revoke_session(_request(), _access())

    assert result["ok"] is True
    assert result["data"] == {"revoked": True, "scope": "global"}
    assert auth_client.revoked == [{"jwt": "access-token", "scope": "global"}]


@pytest.mark.anyio
async def test_extension_handoff_logout_reports_provider_revocation_failure():
    service = _service()
    service._auth_client = FailingRevokingAuthClient()

    with pytest.raises(Exception) as exc:
        await service.revoke_session(_request(), _access())

    assert getattr(exc.value, "code", "") == "handoff_logout_failed"


@pytest.mark.anyio
async def test_extension_handoff_logout_requires_authenticated_access_token():
    service = _service()
    service._auth_client = RevokingAuthClient()

    with pytest.raises(Exception) as exc:
        await service.revoke_session(_request(), _access(access_token=None))

    assert getattr(exc.value, "code", "") == "handoff_logout_failed"


@pytest.mark.anyio
async def test_extension_handoff_refresh_token_reuse_fails_after_logout_revocation():
    service = _service()
    service._auth_client = RefreshRevokingAuthClient()
    request = _request()

    before_logout = await service.refresh_session(request, HandoffRefreshRequest(refresh_token="refresh-token"))
    assert before_logout["ok"] is True

    await service.revoke_session(request, _access())

    with pytest.raises(Exception) as exc:
        await service.refresh_session(request, HandoffRefreshRequest(refresh_token="refresh-token"))

    assert getattr(exc.value, "code", "") == "handoff_refresh_failed"


@pytest.mark.anyio
async def test_handoff_issue_uses_repository_backed_throttling():
    service = _service()
    service.repository.rate_limit_decisions = [(False, 42)]

    with pytest.raises(Exception) as exc:
        await service.issue_handoff(
            _request(),
            _access(),
            HandoffIssueRequest(refresh_token="refresh-token", redirect_path="/editor"),
        )

    assert getattr(exc.value, "code", "") == "rate_limit_exceeded"
    assert service.repository.rate_limit_decisions == []


@pytest.mark.anyio
async def test_handoff_exchange_uses_repository_backed_throttling():
    service = _service()
    service.repository.rate_limit_decisions = [(False, 42)]

    with pytest.raises(Exception) as exc:
        await service.exchange_handoff(_request(), SimpleNamespace(code="missing-code"))

    assert getattr(exc.value, "code", "") == "rate_limit_exceeded"
    assert service.repository.rate_limit_decisions == []


@pytest.mark.anyio
async def test_handoff_create_attempt_rejects_unsafe_redirect_before_issue():
    service = _service()

    with pytest.raises(Exception) as exc:
        await service.create_auth_attempt(
            _request(),
            AuthAttemptCreateRequest(redirect_path="https://evil.example/steal"),
        )

    assert getattr(exc.value, "code", "") == "unsafe_redirect"
    assert service.repository.handoff_attempts == {}


@pytest.mark.anyio
async def test_revoked_access_token_denylist_blocks_logged_out_jwt(monkeypatch):
    token = "header.payload.signature"
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    class FakeRepository:
        def __init__(self, *, base_url, service_role_key):
            assert base_url == "http://example.com"
            assert service_role_key == "service"

        def headers(self, *, include_content_type=True, prefer=None):
            return {}

        async def get(self, resource, *, params=None, headers=None):
            assert resource == "revoked_auth_tokens"
            assert params["token_hash"] == f"eq.{token_hash}"
            return SimpleNamespace(json=lambda: [{"token_hash": token_hash}])

    settings = Settings(
        env="prod",
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
    monkeypatch.setattr("app.core.auth.SupabaseRestRepository", FakeRepository)

    assert await is_access_token_revoked(token, settings) is True
