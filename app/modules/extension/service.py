from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hmac
import hashlib
import json
import logging
import secrets
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

from fastapi import Request

from app.core.auth import RequestAuthContext
from app.core.config import Settings, get_settings
from app.core.entitlements import derive_capability_state
from app.core.errors import (
    AppError,
    InvalidTokenError,
    RateLimitExceededError,
    UnsafeRedirectError,
)
from app.core.security import resolve_client_ip, validate_internal_redirect_path
from app.core.serialization import (
    serialize_capability_object,
    serialize_entitlement,
    serialize_module_status,
    serialize_ok_envelope,
    serialize_profile,
)
from app.modules.identity.service import IdentityService
from app.modules.research.taxonomy.service import TaxonomyService

logger = logging.getLogger(__name__)


class HandoffCodeInvalidError(AppError):
    def __init__(self, message: str = "Invalid handoff code.") -> None:
        super().__init__("handoff_invalid", message, 400)


class HandoffCodeExpiredError(AppError):
    def __init__(self, message: str = "Handoff code expired.") -> None:
        super().__init__("handoff_expired", message, 400)


class HandoffCodeUsedError(AppError):
    def __init__(self, message: str = "Handoff code already used.") -> None:
        super().__init__("handoff_already_used", message, 400)


class HandoffPayloadInvalidError(AppError):
    def __init__(self, message: str = "Stored handoff payload is invalid.") -> None:
        super().__init__("handoff_payload_invalid", message, 400)


class HandoffRefreshFailedError(AppError):
    def __init__(self, message: str = "Handoff session refresh failed.") -> None:
        super().__init__("handoff_refresh_failed", message, 401)


class HandoffAttemptInvalidError(AppError):
    def __init__(self, message: str = "Auth attempt is invalid.") -> None:
        super().__init__("auth_attempt_invalid", message, 400)


class HandoffAttemptExpiredError(AppError):
    def __init__(self, message: str = "Auth attempt has expired.") -> None:
        super().__init__("auth_attempt_expired", message, 400)


class ExtensionPersistenceError(AppError):
    def __init__(self, message: str = "Failed to persist extension data.") -> None:
        super().__init__("extension_persistence_failed", message, 503)


class IdempotencyConflictError(AppError):
    def __init__(self, message: str = "Idempotency key was reused with a different request payload.") -> None:
        super().__init__("idempotency_conflict", message, 409)


@dataclass(frozen=True)
class ExtensionAccessContext:
    auth_context: RequestAuthContext
    account_state: Any
    capability_state: Any

    @property
    def user_id(self) -> str:
        return self.auth_context.user_id

    @property
    def access_token(self) -> str | None:
        return self.auth_context.access_token


class ExtensionService:
    def __init__(
        self,
        *,
        settings: Settings,
        repository,
        unlock_service,
        identity_service: IdentityService,
        taxonomy_service: TaxonomyService,
        citations_service,
        quotes_service,
        notes_service,
        workspace_service,
        graph_service,
        auth_client,
    ):
        self.settings = settings
        self.repository = repository
        self.unlock_service = unlock_service
        self.identity_service = identity_service
        self.taxonomy_service = taxonomy_service
        self.citations_service = citations_service
        self.quotes_service = quotes_service
        self.notes_service = notes_service
        self.workspace_service = workspace_service
        self.graph_service = graph_service
        self.auth_client = auth_client

    def status(self) -> dict[str, object]:
        return serialize_module_status(
            module="extension",
            contract=str(self.settings.migration_pack_dir),
            notes=[
                "Extension routes expose only the strict contract surface.",
                "Secure handoff uses one-time auth_handoff_codes and canonical account truth.",
            ],
        )

    async def cleanup_expired_handoff_codes(self) -> int:
        return await self.repository.delete_expired_handoff_codes()

    async def cleanup_expired_handoff_attempts(self) -> int:
        return await self.repository.delete_expired_handoff_attempts()

    async def build_access_context(self, request: Request, auth_context: RequestAuthContext) -> ExtensionAccessContext:
        account_state = await self.identity_service.ensure_account_bootstrapped(auth_context)
        capability_state = derive_capability_state(
            user_id=account_state.profile.user_id,
            tier=account_state.entitlement.tier,
            status=account_state.entitlement.status,
            paid_until=account_state.entitlement.paid_until,
        )
        request.state.auth_context = auth_context
        request.state.capability_state = capability_state
        return ExtensionAccessContext(
            auth_context=auth_context,
            account_state=account_state,
            capability_state=capability_state,
        )

    async def bootstrap(self, access: ExtensionAccessContext) -> dict[str, object]:
        projects = await self.taxonomy_service.list_projects(
            user_id=access.user_id,
            access_token=access.access_token,
            include_archived=False,
        )
        tags = await self.taxonomy_service.list_tags(
            user_id=access.user_id,
            access_token=access.access_token,
        )
        data = {
            "profile": serialize_profile(access.account_state.profile),
            "entitlement": serialize_entitlement(access.account_state.entitlement),
            "capabilities": serialize_capability_object(access.capability_state),
            "app": {
                "origin": self.settings.canonical_app_origin,
                "handoff": {
                    "issue_path": "/api/auth/handoff",
                    "exchange_path": "/api/auth/handoff/exchange",
                    "landing_path": "/auth/handoff",
                    "preferred_destination": "/editor",
                },
            },
            "taxonomy": {
                "recent_projects": projects[:8],
                "recent_tags": tags[:12],
            },
        }
        return serialize_ok_envelope(data)

    async def recent_taxonomy(self, access: ExtensionAccessContext) -> dict[str, object]:
        projects = await self.taxonomy_service.list_projects(
            user_id=access.user_id,
            access_token=access.access_token,
            include_archived=False,
        )
        tags = await self.taxonomy_service.list_tags(
            user_id=access.user_id,
            access_token=access.access_token,
        )
        return serialize_ok_envelope(
            {
                "recent_projects": projects[:8],
                "recent_tags": tags[:12],
            }
        )

    def _safe_redirect_path(self, redirect_path: str | None) -> str:
        candidate = validate_internal_redirect_path(redirect_path)
        parts = urlsplit(candidate)
        normalized_path = parts.path or "/editor"
        if normalized_path.startswith("/api/") or normalized_path.startswith("/auth/"):
            raise UnsafeRedirectError("Redirect path family is not allowed.")
        if not any(
            normalized_path == prefix or normalized_path.startswith(f"{prefix}/")
            for prefix in ("/editor", "/dashboard")
        ):
            raise UnsafeRedirectError("Redirect path family is not allowed.")
        query_pairs = parse_qsl(parts.query, keep_blank_values=True)
        for key, value in query_pairs:
            lowered = key.lower()
            if lowered in {"redirect", "redirect_to", "next", "return_to", "continue"}:
                value_parts = urlsplit(value)
                if value_parts.scheme or value.startswith("//") or value.startswith("/"):
                    raise UnsafeRedirectError("Nested redirect values are not allowed.")
        if "%" in candidate:
            raise UnsafeRedirectError("Encoded redirect payloads are not allowed.")
        suffix = ""
        if parts.query:
            suffix += f"?{parts.query}"
        if parts.fragment:
            suffix += f"#{parts.fragment}"
        return f"{normalized_path}{suffix}"

    async def _enforce_rate_limit(self, request: Request, *, scope: str, identity: str, limit: int, window_seconds: int) -> None:
        limiter = request.app.state.rate_limiter
        allowed, aux = await limiter.hit(
            f"extension:{scope}:{identity}",
            limit=limit,
            window_seconds=window_seconds,
        )
        if not allowed:
            raise RateLimitExceededError(retry_after_seconds=aux)

    def _rate_limit_identity(self, request: Request, user_id: str | None = None) -> str:
        return user_id or resolve_client_ip(request, self.settings)

    def _attempt_expiry(self) -> str:
        attempt_ttl_seconds = max(self.settings.auth_handoff_ttl_seconds * 3, 180)
        return (datetime.now(timezone.utc) + timedelta(seconds=attempt_ttl_seconds)).isoformat()

    def _attempt_secret_hash(self, attempt_secret: str) -> str:
        return hashlib.sha256(attempt_secret.encode("utf-8")).hexdigest()

    def _session_payload(self, *, access_token: str | None, refresh_token: str, expires_in: int | None, token_type: str | None) -> dict[str, Any]:
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "token_type": token_type or "bearer",
        }

    async def _create_one_time_handoff_code(
        self,
        *,
        user_id: str,
        redirect_path: str,
        session_payload: dict[str, Any],
    ) -> tuple[str, str]:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=self.settings.auth_handoff_ttl_seconds)).isoformat()
        code = secrets.token_urlsafe(32)
        created = await self.repository.create_handoff_code(
            code=code,
            user_id=user_id,
            redirect_path=redirect_path,
            session_payload=session_payload,
            expires_at=expires_at,
        )
        if created is None:
            raise ExtensionPersistenceError("Failed to issue handoff code.")
        return code, expires_at

    async def issue_handoff(self, request: Request, access: ExtensionAccessContext, payload) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="handoff_issue",
            identity=self._rate_limit_identity(request, access.user_id),
            limit=self.settings.rate_limits.auth_sensitive_limit,
            window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
        )
        redirect_path = self._safe_redirect_path(payload.redirect_path)
        session_payload = self._session_payload(
            access_token=access.access_token,
            refresh_token=payload.refresh_token,
            expires_in=payload.expires_in,
            token_type=payload.token_type,
        )
        code, expires_at = await self._create_one_time_handoff_code(
            user_id=access.user_id,
            redirect_path=redirect_path,
            session_payload=session_payload,
        )
        return serialize_ok_envelope(
            {
                "code": code,
                "redirect_path": redirect_path,
                "expires_at": expires_at,
            }
        )

    async def create_auth_attempt(self, request: Request, payload) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="auth_attempt_create",
            identity=self._rate_limit_identity(request),
            limit=self.settings.rate_limits.auth_sensitive_limit,
            window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
        )
        redirect_path = self._safe_redirect_path(payload.redirect_path)
        attempt_id = secrets.token_urlsafe(24)
        attempt_token = secrets.token_urlsafe(32)
        expires_at = self._attempt_expiry()
        created = await self.repository.create_handoff_attempt(
            attempt_id=attempt_id,
            attempt_secret_hash=self._attempt_secret_hash(attempt_token),
            redirect_path=redirect_path,
            expires_at=expires_at,
        )
        if created is None:
            raise ExtensionPersistenceError("Failed to create auth attempt.")
        logger.info("Auth attempt created", extra={"attempt_id": attempt_id})
        return serialize_ok_envelope(
            {
                "attempt_id": attempt_id,
                "attempt_token": attempt_token,
                "status": "pending",
                "redirect_path": redirect_path,
                "expires_at": expires_at,
            }
        )

    async def complete_auth_attempt(
        self,
        request: Request,
        *,
        attempt_id: str,
        auth_context: RequestAuthContext,
        payload,
    ) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="auth_attempt_complete",
            identity=self._rate_limit_identity(request, auth_context.user_id),
            limit=self.settings.rate_limits.auth_sensitive_limit,
            window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
        )
        attempt = await self.repository.get_handoff_attempt(attempt_id=attempt_id)
        if attempt is None:
            raise HandoffAttemptInvalidError()
        now = datetime.now(timezone.utc)
        try:
            expires_at = datetime.fromisoformat(str(attempt.get("expires_at")).replace("Z", "+00:00"))
        except Exception as exc:
            raise HandoffAttemptInvalidError("Auth attempt expiry is invalid.") from exc
        if expires_at <= now:
            raise HandoffAttemptExpiredError()
        if attempt.get("status") == "ready" and attempt.get("handoff_code"):
            return serialize_ok_envelope(
                {
                    "attempt_id": attempt_id,
                    "status": "ready",
                    "redirect_path": self._safe_redirect_path(payload.redirect_path or attempt.get("redirect_path")),
                    "expires_at": attempt.get("expires_at"),
                }
            )
        if attempt.get("status") not in {"pending", "ready"}:
            raise HandoffAttemptInvalidError("Auth attempt is no longer completable.")
        redirect_path = self._safe_redirect_path(payload.redirect_path or attempt.get("redirect_path"))
        session_payload = self._session_payload(
            access_token=auth_context.access_token,
            refresh_token=payload.refresh_token,
            expires_in=payload.expires_in,
            token_type=payload.token_type,
        )
        handoff_code, handoff_expires_at = await self._create_one_time_handoff_code(
            user_id=auth_context.user_id,
            redirect_path=redirect_path,
            session_payload=session_payload,
        )
        ready_at = datetime.now(timezone.utc).isoformat()
        marked = await self.repository.mark_handoff_attempt_ready(
            attempt_id=attempt_id,
            user_id=auth_context.user_id,
            handoff_code=handoff_code,
            ready_at=ready_at,
        )
        if marked is None:
            raise HandoffAttemptInvalidError("Auth attempt could not be marked ready.")
        logger.info("Auth attempt marked ready", extra={"attempt_id": attempt_id, "user_id": auth_context.user_id})
        return serialize_ok_envelope(
            {
                "attempt_id": attempt_id,
                "status": "ready",
                "redirect_path": redirect_path,
                "expires_at": attempt.get("expires_at"),
                "exchange_expires_at": handoff_expires_at,
            }
        )

    async def auth_attempt_status(self, request: Request, *, attempt_id: str, attempt_token: str) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="auth_attempt_status",
            identity=self._rate_limit_identity(request),
            limit=self.settings.rate_limits.auth_sensitive_limit * 3,
            window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
        )
        attempt = await self.repository.get_handoff_attempt(attempt_id=attempt_id)
        if attempt is None:
            raise HandoffAttemptInvalidError()
        expected_hash = str(attempt.get("attempt_secret_hash") or "")
        provided_hash = self._attempt_secret_hash((attempt_token or "").strip())
        if not expected_hash or not hmac.compare_digest(expected_hash, provided_hash):
            raise HandoffAttemptInvalidError("Auth attempt token is invalid.")
        now = datetime.now(timezone.utc)
        try:
            expires_at = datetime.fromisoformat(str(attempt.get("expires_at")).replace("Z", "+00:00"))
        except Exception as exc:
            raise HandoffAttemptInvalidError("Auth attempt expiry is invalid.") from exc
        if expires_at <= now:
            raise HandoffAttemptExpiredError()
        status = str(attempt.get("status") or "pending")
        response: dict[str, Any] = {
            "attempt_id": attempt_id,
            "status": status,
            "redirect_path": attempt.get("redirect_path"),
            "expires_at": attempt.get("expires_at"),
        }
        if status == "ready" and attempt.get("handoff_code"):
            response["exchange"] = {
                "code": attempt.get("handoff_code"),
                "exchange_path": "/api/auth/handoff/exchange",
            }
        return serialize_ok_envelope(response)

    def _load_stored_session(self, record: dict[str, Any]) -> dict[str, Any]:
        payload = record.get("session_payload")
        if not isinstance(payload, dict):
            payload = {}
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token") or record.get("refresh_token")
        expires_in = payload.get("expires_in")
        token_type = payload.get("token_type") or record.get("token_type") or "bearer"
        if not access_token or not refresh_token:
            raise HandoffPayloadInvalidError()
        return {
            "access_token": str(access_token),
            "refresh_token": str(refresh_token),
            "expires_in": expires_in if isinstance(expires_in, int) else record.get("expires_in"),
            "token_type": str(token_type),
        }

    async def _refresh_or_validate_session(self, session_payload: dict[str, Any], *, expected_user_id: str) -> dict[str, Any]:
        access_token = session_payload["access_token"]
        try:
            response = self.auth_client.auth.get_user(access_token)
            user = getattr(response, "user", None)
            if user is None or str(getattr(user, "id", "")) != expected_user_id:
                raise InvalidTokenError("Stored handoff access token is invalid.")
            return session_payload
        except Exception:
            pass
        try:
            refreshed = self.auth_client.auth.refresh_session(session_payload["refresh_token"])
        except Exception as exc:
            raise HandoffRefreshFailedError() from exc
        session = getattr(refreshed, "session", None)
        if session is None:
            raise HandoffRefreshFailedError()
        new_access_token = getattr(session, "access_token", None)
        new_refresh_token = getattr(session, "refresh_token", None)
        if not new_access_token or not new_refresh_token:
            raise HandoffRefreshFailedError()
        revalidated = self.auth_client.auth.get_user(new_access_token)
        user = getattr(revalidated, "user", None)
        if user is None or str(getattr(user, "id", "")) != expected_user_id:
            raise HandoffRefreshFailedError("Handoff session revalidation failed.")
        return {
            "access_token": str(new_access_token),
            "refresh_token": str(new_refresh_token),
            "expires_in": getattr(session, "expires_in", None),
            "token_type": str(getattr(session, "token_type", "bearer")),
        }

    async def exchange_handoff(self, request: Request, payload) -> dict[str, object]:
        try:
            await self._enforce_rate_limit(
                request,
                scope="handoff_exchange",
                identity=self._rate_limit_identity(request),
                limit=self.settings.rate_limits.auth_sensitive_limit,
                window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
            )
            record = await self.repository.get_handoff_code(code=payload.code)
            if record is None:
                raise HandoffCodeInvalidError()
            safe_redirect = self._safe_redirect_path(record.get("redirect_path"))
            now = datetime.now(timezone.utc)
            used_at = record.get("used_at")
            if used_at:
                await self.repository.clear_handoff_session_payload(record_id=str(record["id"]))
                raise HandoffCodeUsedError()
            expires_at_raw = record.get("expires_at")
            try:
                expires_at = datetime.fromisoformat(str(expires_at_raw).replace("Z", "+00:00"))
            except Exception:
                await self.repository.invalidate_handoff_code(record_id=str(record["id"]), used_at=now.isoformat())
                raise HandoffPayloadInvalidError("Stored handoff expiry is invalid.")
            if expires_at <= now:
                await self.repository.invalidate_handoff_code(record_id=str(record["id"]), used_at=now.isoformat())
                raise HandoffCodeExpiredError()
            consumed = await self.repository.consume_handoff_code(record_id=str(record["id"]), used_at=now.isoformat())
            if consumed is None:
                raise HandoffCodeUsedError()
            try:
                stored_session = self._load_stored_session(record)
                session_payload = await self._refresh_or_validate_session(stored_session, expected_user_id=str(record["user_id"]))
                await self.repository.mark_handoff_attempt_exchanged(
                    handoff_code=payload.code,
                    exchanged_at=datetime.now(timezone.utc).isoformat(),
                )
                logger.info("Handoff exchange succeeded")
                return serialize_ok_envelope(
                    {
                        "redirect_path": safe_redirect,
                        "session": session_payload,
                    }
                )
            except AppError:
                await self.repository.clear_handoff_session_payload(record_id=str(record["id"]))
                raise
            finally:
                await self.repository.clear_handoff_session_payload(record_id=str(record["id"]))
        except AppError:
            raise
        except Exception as exc:
            raise ExtensionPersistenceError("Handoff exchange failed.") from exc

    def handoff_redirect_url(self, code: str) -> str:
        normalized_code = (code or "").strip()
        if not normalized_code:
            raise HandoffCodeInvalidError("Missing handoff code.")
        query = urlencode({"code": normalized_code}, quote_via=quote)
        return f"{self.settings.canonical_app_origin}/auth/handoff?{query}"

    async def capture_citation(self, access: ExtensionAccessContext, payload) -> dict[str, object]:
        citation = await self.citations_service.create_citation(
            user_id=access.user_id,
            access_token=access.access_token,
            account_type=access.capability_state.tier,
            payload=payload.model_dump(exclude_none=True),
        )
        return serialize_ok_envelope(citation)

    async def capture_quote(self, access: ExtensionAccessContext, payload) -> dict[str, object]:
        quote = await self.quotes_service.create_quote(
            user_id=access.user_id,
            access_token=access.access_token,
            payload=payload.model_dump(exclude_none=True),
        )
        return serialize_ok_envelope(quote)

    async def capture_note(self, access: ExtensionAccessContext, payload) -> dict[str, object]:
        note = await self.notes_service.create_note(
            user_id=access.user_id,
            access_token=access.access_token,
            payload=payload.model_dump(exclude_none=True),
        )
        return serialize_ok_envelope(note)

    def _default_document_title(self, payload) -> str:
        if payload.document_title:
            return payload.document_title
        if payload.title:
            return payload.title
        parsed = urlsplit(payload.url)
        return parsed.netloc or "New document"

    def _safe_editor_path(self, document_id: str, seed: dict[str, Any] | None = None) -> str:
        seed = seed or {}
        params = [f"document_id={document_id}", "seeded=1"]
        if seed.get("source_id"):
            params.append(f"seed_source_id={seed['source_id']}")
        if seed.get("citation_id"):
            params.append(f"seed_citation_id={seed['citation_id']}")
        if seed.get("quote_id"):
            params.append(f"seed_quote_id={seed['quote_id']}")
        if seed.get("note_id"):
            params.append(f"seed_note_id={seed['note_id']}")
        if seed.get("mode"):
            params.append(f"seed_mode={seed['mode']}")
        return self._safe_redirect_path("/editor?" + "&".join(params))

    def _request_hash(self, payload: dict[str, Any]) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    async def _idempotency_result(
        self,
        request: Request,
        *,
        user_id: str,
        key: str,
        request_hash: str,
    ) -> dict[str, object] | None:
        store = getattr(request.app.state, "extension_idempotency_store", None)
        if store is None:
            request.app.state.extension_idempotency_store = {}
            store = request.app.state.extension_idempotency_store
        record = store.get((user_id, key))
        if not record:
            return None
        if record["expires_at"] <= datetime.now(timezone.utc):
            store.pop((user_id, key), None)
            return None
        if record["request_hash"] != request_hash:
            raise IdempotencyConflictError()
        return record["response_payload"]

    async def _store_idempotency_result(
        self,
        request: Request,
        *,
        user_id: str,
        key: str,
        request_hash: str,
        response: dict[str, object],
    ) -> None:
        store = getattr(request.app.state, "extension_idempotency_store", None)
        if store is None:
            request.app.state.extension_idempotency_store = {}
            store = request.app.state.extension_idempotency_store
        store[(user_id, key)] = {
            "idempotency_key": key,
            "user_id": user_id,
            "request_hash": request_hash,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(seconds=self.settings.extension_idempotency_ttl_seconds),
            "response_payload": response,
        }

    async def work_in_editor(self, request: Request, access: ExtensionAccessContext, payload) -> dict[str, object]:
        if payload.idempotency_key:
            request_hash = self._request_hash(payload.model_dump(exclude_none=True))
            cached = await self._idempotency_result(
                request,
                user_id=access.user_id,
                key=payload.idempotency_key,
                request_hash=request_hash,
            )
            if cached is not None:
                return cached
        workflow = await self.graph_service.orchestrate_work_in_editor(
            user_id=access.user_id,
            access_token=access.access_token,
            capability_state=access.capability_state,
            payload=payload,
            default_document_title=self._default_document_title(payload),
        )
        document_id = workflow["document_id"]
        editor_path = self._safe_editor_path(document_id, workflow["seed"])
        response = serialize_ok_envelope(
            {
                "document_id": document_id,
                "seed": workflow["seed"],
                "redirect_path": editor_path,
                "document": workflow["document"],
                "citation": workflow["citation"],
                "quote": workflow["quote"],
                "note": workflow["note"],
                "editor_path": editor_path,
                "editor_url": editor_path,
            }
        )
        if payload.idempotency_key:
            await self._store_idempotency_result(
                request,
                user_id=access.user_id,
                key=payload.idempotency_key,
                request_hash=request_hash,
                response=response,
            )
        return response

    async def record_usage_event(self, request: Request, access: ExtensionAccessContext, payload) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="usage_event",
            identity=self._rate_limit_identity(request, access.user_id),
            limit=self.settings.rate_limits.future_write_heavy_limit,
            window_seconds=self.settings.rate_limits.future_write_heavy_window_seconds,
        )
        parsed = urlsplit(payload.url)
        domain = parsed.netloc.strip().lower()
        if not domain:
            raise ExtensionPersistenceError("Unlock activity URL is invalid.")
        response = await self.unlock_service.record_activity_event(
            user_id=access.user_id,
            payload={
                "url": payload.url,
                "domain": domain,
                "event_type": payload.event_type,
                "event_id": payload.event_id,
                "source": "extension",
                "was_cleaned": payload.was_cleaned,
            },
        )
        return response


def build_extension_service(
    *,
    repository,
    unlock_service,
    identity_service: IdentityService,
    taxonomy_service: TaxonomyService,
    citations_service,
    quotes_service,
    notes_service,
    workspace_service,
    graph_service,
    auth_client,
) -> ExtensionService:
    return ExtensionService(
        settings=get_settings(),
        repository=repository,
        unlock_service=unlock_service,
        identity_service=identity_service,
        taxonomy_service=taxonomy_service,
        citations_service=citations_service,
        quotes_service=quotes_service,
        notes_service=notes_service,
        workspace_service=workspace_service,
        graph_service=graph_service,
        auth_client=auth_client,
    )
