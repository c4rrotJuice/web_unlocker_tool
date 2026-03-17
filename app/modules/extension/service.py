from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
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

    async def issue_handoff(self, request: Request, access: ExtensionAccessContext, payload) -> dict[str, object]:
        await self._enforce_rate_limit(
            request,
            scope="handoff_issue",
            identity=self._rate_limit_identity(request, access.user_id),
            limit=self.settings.rate_limits.auth_sensitive_limit,
            window_seconds=self.settings.rate_limits.auth_sensitive_window_seconds,
        )
        redirect_path = self._safe_redirect_path(payload.redirect_path)
        session_payload = {
            "access_token": access.access_token,
            "refresh_token": payload.refresh_token,
            "expires_in": payload.expires_in,
            "token_type": payload.token_type or "bearer",
        }
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=self.settings.auth_handoff_ttl_seconds)).isoformat()
        code = secrets.token_urlsafe(32)
        created = await self.repository.create_handoff_code(
            code=code,
            user_id=access.user_id,
            redirect_path=redirect_path,
            session_payload=session_payload,
            expires_at=expires_at,
        )
        if created is None:
            raise ExtensionPersistenceError("Failed to issue handoff code.")
        return serialize_ok_envelope(
            {
                "code": code,
                "redirect_path": redirect_path,
                "expires_at": expires_at,
            }
        )

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

    def _document_seed(self, payload, citation: dict[str, Any], quote: dict[str, Any] | None, note: dict[str, Any] | None) -> dict[str, Any]:
        lines: list[str] = []
        if payload.title:
            lines.append(f"{payload.title}\n")
        if quote and quote.get("excerpt"):
            lines.append(f"{quote['excerpt']}\n\n")
        elif payload.selected_text:
            lines.append(f"{payload.selected_text}\n\n")
        if note and note.get("note_body"):
            lines.append(f"{note['note_body']}\n")
        elif payload.citation_text:
            lines.append(f"Source: {payload.citation_text}\n")
        text = "".join(lines) or "\n"
        return {
            "ops": [{"insert": text}],
            "document_id": None,
            "source_id": citation.get("source_id") or (citation.get("source") or {}).get("id"),
            "citation_id": citation.get("id"),
            "quote_id": quote.get("id") if quote else None,
            "note_id": note.get("id") if note else None,
            "mode": "quote_focus" if quote else "seed_review",
        }

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
        citation_payload = {
            "url": payload.url,
            "metadata": payload.metadata,
            "excerpt": payload.selected_text,
            "quote": payload.selected_text,
            "locator": payload.locator,
            "style": payload.citation_format,
            "annotation": None,
            "extraction_payload": payload.extraction_payload,
        }
        citation = await self.citations_service.create_citation(
            user_id=access.user_id,
            access_token=access.access_token,
            account_type=access.capability_state.tier,
            payload=citation_payload,
        )
        quote = None
        if payload.selected_text:
            quote = await self.quotes_service.create_quote(
                user_id=access.user_id,
                access_token=access.access_token,
                payload={
                    "citation_id": citation["id"],
                    "excerpt": payload.selected_text,
                    "locator": payload.locator,
                    "annotation": None,
                },
            )
        note = None
        if payload.note is not None:
            note_title = payload.note.title or payload.title or "Captured note"
            note = await self.notes_service.create_note(
                user_id=access.user_id,
                access_token=access.access_token,
                payload={
                    "title": note_title,
                    "note_body": payload.note.note_body,
                    "highlight_text": payload.selected_text,
                    "project_id": payload.note.project_id or payload.project_id,
                    "citation_id": citation["id"],
                    "quote_id": quote["id"] if quote else None,
                    "tag_ids": payload.note.tag_ids,
                    "sources": [source.model_dump(exclude_none=True) for source in payload.note.sources],
                    "linked_note_ids": [],
                },
            )
        document = await self.workspace_service.create_document(
            user_id=access.user_id,
            access_token=access.access_token,
            capability_state=access.capability_state,
            payload={
                "title": self._default_document_title(payload),
                "project_id": payload.project_id or (payload.note.project_id if payload.note else None),
            },
        )
        document_id = document["data"]["id"]
        seed = self._document_seed(payload, citation, quote, note)
        seed["document_id"] = document_id
        document = await self.workspace_service.update_document(
            user_id=access.user_id,
            access_token=access.access_token,
            capability_state=access.capability_state,
            document_id=document_id,
            payload={"content_delta": {"ops": seed["ops"]}},
        )
        document = await self.workspace_service.replace_document_citations(
            user_id=access.user_id,
            access_token=access.access_token,
            capability_state=access.capability_state,
            document_id=document_id,
            citation_ids=[citation["id"]],
        )
        if note is not None:
            document = await self.workspace_service.replace_document_notes(
                user_id=access.user_id,
                access_token=access.access_token,
                capability_state=access.capability_state,
                document_id=document_id,
                note_ids=[note["id"]],
            )
        editor_path = self._safe_editor_path(document_id, seed)
        response = serialize_ok_envelope(
            {
                "document_id": document_id,
                "seed": self.workspace_service.summarize_seed(seed),
                "redirect_path": editor_path,
                "document": document["data"],
                "citation": citation,
                "quote": quote,
                "note": note,
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
        auth_client=auth_client,
    )
