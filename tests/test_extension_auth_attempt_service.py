from __future__ import annotations

import hashlib
from types import SimpleNamespace
from pathlib import Path

import pytest

from app.core.auth import RequestAuthContext
from app.core.config import RateLimitSettings, Settings
from app.modules.extension.schemas import AuthAttemptCompleteRequest, AuthAttemptCreateRequest, HandoffExchangeRequest, WorkInEditorRequest
from app.modules.extension.service import ExtensionAccessContext, ExtensionService


class AllowAllRateLimiter:
    async def hit(self, _key, *, limit, window_seconds):
        return True, max(limit - 1, 0)


class InMemoryExtensionRepository:
    def __init__(self):
        self.handoff_attempts: dict[str, dict[str, object]] = {}
        self.handoff_codes: dict[str, dict[str, object]] = {}
        self.rate_limits: dict[tuple[str, str], int] = {}
        self.rate_limit_decisions: list[tuple[bool, int]] = []
        self.revoked_tokens: dict[str, dict[str, object]] = {}
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

    async def hit_auth_rate_limit(self, *, scope, identity, limit, window_seconds):
        if self.rate_limit_decisions:
            return self.rate_limit_decisions.pop(0)
        key = (scope, identity)
        count = self.rate_limits.get(key, 0) + 1
        self.rate_limits[key] = count
        return count <= limit, max(limit - count, 0) if count <= limit else window_seconds

    async def record_revoked_access_token(self, *, access_token, user_id, expires_at):
        token_hash = hashlib.sha256(access_token.encode("utf-8")).hexdigest()
        self.revoked_tokens[token_hash] = {
            "token_hash": token_hash,
            "user_id": user_id,
            "expires_at": expires_at,
        }


class CleanupFailingExtensionRepository(InMemoryExtensionRepository):
    async def clear_handoff_session_payload(self, *, record_id):
        raise RuntimeError("cleanup failed")


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
        graph_service=SimpleNamespace(),
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


@pytest.mark.anyio
async def test_handoff_exchange_rejects_missing_and_expired_codes_explicitly():
    service = _service()
    request = _request()

    with pytest.raises(Exception) as missing:
        await service.exchange_handoff(request, HandoffExchangeRequest(code="missing-code"))
    assert getattr(missing.value, "code", "") == "handoff_invalid"

    await service.repository.create_handoff_code(
        code="expired-code",
        user_id="user-1",
        redirect_path="/editor",
        session_payload={
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 300,
            "token_type": "bearer",
        },
        expires_at="2000-01-01T00:00:00+00:00",
    )

    with pytest.raises(Exception) as expired:
        await service.exchange_handoff(request, HandoffExchangeRequest(code="expired-code"))
    assert getattr(expired.value, "code", "") == "handoff_expired"


@pytest.mark.anyio
async def test_handoff_exchange_rejects_bad_expiry_with_payload_error():
    service = _service()
    request = _request()

    await service.repository.create_handoff_code(
        code="bad-expiry-code",
        user_id="user-1",
        redirect_path="/editor",
        session_payload={
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 300,
            "token_type": "bearer",
        },
        expires_at="not-a-timestamp",
    )

    with pytest.raises(Exception) as invalid:
        await service.exchange_handoff(request, HandoffExchangeRequest(code="bad-expiry-code"))

    assert getattr(invalid.value, "code", "") == "handoff_payload_invalid"
    record = await service.repository.get_handoff_code(code="bad-expiry-code")
    assert record["used_at"] is not None
    assert record["session_payload"] == {}


@pytest.mark.anyio
async def test_handoff_exchange_succeeds_even_if_cleanup_write_fails():
    service = _service()
    service.repository = CleanupFailingExtensionRepository()
    request = _request()

    created = await service.create_auth_attempt(request, AuthAttemptCreateRequest(redirect_path="/dashboard"))
    attempt_id = created["data"]["attempt_id"]

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

    attempt_record = await service.repository.get_handoff_attempt(attempt_id=attempt_id)
    exchange_code = attempt_record["handoff_code"]
    exchanged = await service.exchange_handoff(request, HandoffExchangeRequest(code=exchange_code))

    assert exchanged["ok"] is True
    assert exchanged["data"]["session"]["access_token"] == "access-token"


@pytest.mark.anyio
async def test_handoff_exchange_rejects_reuse_after_one_time_consumption():
    service = _service()
    request = _request()
    access = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="access-token",
        token_claims={"sub": "user-1"},
    )

    issued = await service.issue_handoff(
        request,
        access,
        SimpleNamespace(redirect_path="/editor", refresh_token="refresh-token", expires_in=300, token_type="bearer"),
    )
    code = issued["data"]["code"]

    exchanged = await service.exchange_handoff(request, HandoffExchangeRequest(code=code))
    assert exchanged["ok"] is True

    with pytest.raises(Exception) as replay:
        await service.exchange_handoff(request, HandoffExchangeRequest(code=code))
    assert getattr(replay.value, "code", "") == "handoff_already_used"


@pytest.mark.anyio
async def test_work_in_editor_returns_canonical_seeded_editor_launch_contract():
    class GraphService:
        async def orchestrate_work_in_editor(self, *, user_id, access_token, capability_state, payload, default_document_title):
            assert user_id == "user-1"
            assert access_token == "access-token"
            assert capability_state.tier == "standard"
            assert default_document_title == "Example article"
            return {
                "document_id": "doc-1",
                "document": {"id": "doc-1", "title": "Example article"},
                "citation": {"id": "citation-1"},
                "quote": {"id": "quote-1"},
                "note": {"id": "note-1"},
                "seed": {
                    "document_id": "doc-1",
                    "source_id": "source-1",
                    "citation_id": "citation-1",
                    "quote_id": "quote-1",
                    "note_id": "note-1",
                    "mode": "quote_focus",
                },
            }

    service = _service()
    service.graph_service = GraphService()
    request = _request()
    access = ExtensionAccessContext(
        auth_context=RequestAuthContext(
            authenticated=True,
            user_id="user-1",
            supabase_subject="user-1",
            email="user@example.com",
            access_token="access-token",
            token_claims={"sub": "user-1"},
        ),
        account_state=SimpleNamespace(profile=SimpleNamespace(), entitlement=SimpleNamespace()),
        capability_state=SimpleNamespace(tier="standard", capabilities={"documents": {}, "exports": []}),
    )
    payload = WorkInEditorRequest(
        url="https://example.com/article",
        title="Example article",
        selected_text="Quoted text",
        extraction_payload={
            "canonical_url": "https://example.com/article",
            "page_url": "https://example.com/article",
            "title_candidates": [{"value": "Example article", "confidence": 1.0}],
            "author_candidates": [{"value": "Ada Lovelace", "confidence": 0.9}],
            "date_candidates": [{"value": "2024-02-03", "confidence": 0.9}],
            "locator": {"paragraph": 2},
            "raw_metadata": {"quote": "Quoted text", "excerpt": "Quoted text"},
        },
        locator={"paragraph": 2},
        citation_text="Example citation text",
        project_id="project-1",
    )

    response = await service.work_in_editor(request, access, payload)

    assert response["ok"] is True
    assert response["data"]["document_id"] == "doc-1"
    assert response["data"]["seed"]["document_id"] == "doc-1"
    assert response["data"]["seed"]["citation_id"] == "citation-1"
    assert response["data"]["editor_path"] == "/editor?document_id=doc-1&seeded=1&seed_source_id=source-1&seed_citation_id=citation-1&seed_quote_id=quote-1&seed_note_id=note-1&seed_mode=quote_focus"
    assert response["data"]["redirect_path"] == response["data"]["editor_path"]
    assert response["data"]["editor_url"] == response["data"]["editor_path"]
