from __future__ import annotations

from types import SimpleNamespace
from pathlib import Path

import pytest

from app.core.auth import RequestAuthContext
from app.core.config import RateLimitSettings, Settings
from app.modules.extension.schemas import AuthAttemptCompleteRequest, AuthAttemptCreateRequest, HandoffExchangeRequest
from app.modules.extension.service import ExtensionService


class AllowAllRateLimiter:
    async def hit(self, _key, *, limit, window_seconds):
        return True, max(limit - 1, 0)


class InMemoryExtensionRepository:
    def __init__(self):
        self.handoff_attempts: dict[str, dict[str, object]] = {}
        self.handoff_codes: dict[str, dict[str, object]] = {}
        self._next_id = 0

    def _id(self) -> str:
        self._next_id += 1
        return str(self._next_id)

    async def create_handoff_attempt(self, *, attempt_id, attempt_secret_hash, redirect_path, expires_at):
        record = {
            "id": self._id(),
            "attempt_id": attempt_id,
            "attempt_secret_hash": attempt_secret_hash,
            "status": "pending",
            "redirect_path": redirect_path,
            "expires_at": expires_at,
            "user_id": None,
            "handoff_code": None,
            "ready_at": None,
            "exchanged_at": None,
            "created_at": expires_at,
            "updated_at": expires_at,
        }
        self.handoff_attempts[attempt_id] = record
        return dict(record)

    async def get_handoff_attempt(self, *, attempt_id):
        record = self.handoff_attempts.get(attempt_id)
        return dict(record) if record else None

    async def mark_handoff_attempt_ready(self, *, attempt_id, user_id, handoff_code, ready_at):
        record = self.handoff_attempts.get(attempt_id)
        if not record or record.get("status") != "pending":
            return None
        record.update({
            "status": "ready",
            "user_id": user_id,
            "handoff_code": handoff_code,
            "ready_at": ready_at,
            "updated_at": ready_at,
        })
        return dict(record)

    async def mark_handoff_attempt_exchanged(self, *, handoff_code, exchanged_at):
        for record in self.handoff_attempts.values():
            if record.get("handoff_code") == handoff_code:
                record.update({"status": "exchanged", "exchanged_at": exchanged_at, "updated_at": exchanged_at})
                return

    async def create_handoff_code(self, *, code, user_id, redirect_path, session_payload, expires_at):
        record = {
            "id": self._id(),
            "code": code,
            "user_id": user_id,
            "redirect_path": redirect_path,
            "session_payload": dict(session_payload),
            "expires_at": expires_at,
            "used_at": None,
            "created_at": expires_at,
            "refresh_token": session_payload.get("refresh_token"),
            "expires_in": session_payload.get("expires_in"),
            "token_type": session_payload.get("token_type"),
        }
        self.handoff_codes[code] = record
        return dict(record)

    async def get_handoff_code(self, *, code):
        record = self.handoff_codes.get(code)
        return dict(record) if record else None

    async def consume_handoff_code(self, *, record_id, used_at):
        for record in self.handoff_codes.values():
            if str(record["id"]) == str(record_id) and record.get("used_at") is None:
                record["used_at"] = used_at
                return dict(record)
        return None

    async def clear_handoff_session_payload(self, *, record_id):
        for record in self.handoff_codes.values():
            if str(record["id"]) == str(record_id):
                record["session_payload"] = {}
                return

    async def invalidate_handoff_code(self, *, record_id, used_at):
        for record in self.handoff_codes.values():
            if str(record["id"]) == str(record_id):
                record["used_at"] = used_at
                record["session_payload"] = {}
                return

    async def delete_expired_handoff_codes(self):
        return 0

    async def delete_expired_handoff_attempts(self):
        return 0


class FakeAuthClient:
    class _Auth:
        def get_user(self, token):
            return SimpleNamespace(user=SimpleNamespace(id="user-1", email="user@example.com")) if token else SimpleNamespace(user=None)

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


def _service() -> ExtensionService:
    repository = InMemoryExtensionRepository()
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
    return ExtensionService(
        settings=settings,
        repository=repository,
        unlock_service=SimpleNamespace(),
        identity_service=SimpleNamespace(),
        taxonomy_service=SimpleNamespace(),
        citations_service=SimpleNamespace(),
        quotes_service=SimpleNamespace(),
        notes_service=SimpleNamespace(),
        workspace_service=SimpleNamespace(),
        auth_client=FakeAuthClient(),
    )


def _request():
    return SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(rate_limiter=AllowAllRateLimiter())),
        client=SimpleNamespace(host="127.0.0.1"),
    )


@pytest.mark.anyio
async def test_auth_attempt_flow_completes_via_pollable_ready_state_and_one_time_exchange():
    service = _service()
    request = _request()

    created = await service.create_auth_attempt(request, AuthAttemptCreateRequest(redirect_path="/dashboard"))
    attempt_id = created["data"]["attempt_id"]
    attempt_token = created["data"]["attempt_token"]

    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="access-token",
        token_claims={"sub": "user-1"},
    )
    await service.complete_auth_attempt(
        request,
        attempt_id=attempt_id,
        auth_context=auth_context,
        payload=AuthAttemptCompleteRequest(refresh_token="refresh-token", redirect_path="/dashboard"),
    )

    status = await service.auth_attempt_status(request, attempt_id=attempt_id, attempt_token=attempt_token)
    exchange_code = status["data"]["exchange"]["code"]
    exchanged = await service.exchange_handoff(request, HandoffExchangeRequest(code=exchange_code))

    assert exchanged["ok"] is True
    assert exchanged["data"]["session"]["access_token"]

    with pytest.raises(Exception) as replay:
        await service.exchange_handoff(request, HandoffExchangeRequest(code=exchange_code))
    assert getattr(replay.value, "code", "") in {"handoff_already_used", "handoff_payload_invalid"}


@pytest.mark.anyio
async def test_auth_attempt_status_rejects_invalid_token():
    service = _service()
    request = _request()
    created = await service.create_auth_attempt(request, AuthAttemptCreateRequest(redirect_path="/dashboard"))

    with pytest.raises(Exception) as exc:
        await service.auth_attempt_status(
            request,
            attempt_id=created["data"]["attempt_id"],
            attempt_token="wrong-token",
        )
    assert getattr(exc.value, "code", "") == "auth_attempt_invalid"
