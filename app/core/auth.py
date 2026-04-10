from __future__ import annotations

import hashlib
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any

from fastapi import Header, Request
from supabase import create_client

from app.core.account_state import AccountState
from app.core.config import Settings, get_settings
from app.core.entitlements import CapabilityState
from app.core.errors import ExpiredTokenError, InvalidTokenError, MalformedCredentialsError, MissingCredentialsError
from app.core.security import SESSION_COOKIE_NAME
from app.services.supabase_rest import SupabaseRestRepository, response_json


@dataclass(frozen=True)
class RequestAuthContext:
    authenticated: bool
    user_id: str
    supabase_subject: str | None
    email: str | None
    access_token: str | None
    token_claims: dict[str, object]
    account_state: AccountState | None = None
    capability_state: CapabilityState | None = None

    def with_account_state(self, account_state: AccountState) -> "RequestAuthContext":
        return replace(self, account_state=account_state)

    def with_capability_state(self, capability_state: CapabilityState) -> "RequestAuthContext":
        return replace(self, capability_state=capability_state)


def extract_bearer_token(authorization: str | None) -> str:
    if authorization is None or not authorization.strip():
        raise MissingCredentialsError()
    header = authorization.strip()
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise MalformedCredentialsError()
    token = parts[1].strip()
    if not token:
        raise MissingCredentialsError()
    return token


def _safe_claims(user: Any) -> dict[str, object]:
    return {
        "sub": getattr(user, "id", None),
        "email": getattr(user, "email", None),
        "aud": getattr(user, "aud", None),
        "role": getattr(user, "role", None),
    }


def store_request_auth_context(request: Request, context: RequestAuthContext) -> RequestAuthContext:
    request.state.auth_context = context
    return context


class SupabaseTokenVerifier:
    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise RuntimeError("Supabase auth settings are incomplete.")
        self.client = create_client(settings.supabase_url, settings.supabase_anon_key)

    def verify(self, token: str) -> RequestAuthContext:
        try:
            response = self.client.auth.get_user(token)
        except Exception as exc:
            message = str(exc).lower()
            if "expired" in message:
                raise ExpiredTokenError() from exc
            raise InvalidTokenError() from exc
        user = getattr(response, "user", None)
        if user is None or not getattr(user, "id", None):
            raise InvalidTokenError()
        return RequestAuthContext(
            authenticated=True,
            user_id=str(user.id),
            supabase_subject=str(user.id),
            email=getattr(user, "email", None),
            access_token=token,
            token_claims=_safe_claims(user),
        )


@lru_cache(maxsize=1)
def get_token_verifier() -> SupabaseTokenVerifier:
    return SupabaseTokenVerifier(get_settings())


async def is_access_token_revoked(token: str, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if settings.env in {"test", "dev"}:
        return False
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return False
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    repository = SupabaseRestRepository(
        base_url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
    )
    response = await repository.get(
        "revoked_auth_tokens",
        params={
            "token_hash": f"eq.{token_hash}",
            "select": "token_hash",
            "limit": "1",
        },
        headers=repository.headers(include_content_type=False),
    )
    payload = response_json(response)
    if isinstance(payload, list):
        return bool(payload)
    return isinstance(payload, dict) and bool(payload)


async def require_request_auth_context(
    request: Request,
    authorization: str | None = Header(default=None),
) -> RequestAuthContext:
    token = extract_bearer_token(authorization)
    verifier = get_token_verifier()
    context = verifier.verify(token)
    try:
        revoked = await is_access_token_revoked(token)
    except Exception as exc:
        if get_settings().env in {"prod", "staging"}:
            raise InvalidTokenError("Token revocation status could not be verified.") from exc
        revoked = False
    if revoked:
        raise InvalidTokenError("Token has been revoked.")
    return store_request_auth_context(request, context)


async def require_request_auth_context_from_session_cookie(
    request: Request,
) -> RequestAuthContext:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if session_token is None or not session_token.strip():
        raise MissingCredentialsError()
    verifier = get_token_verifier()
    token = session_token.strip()
    context = verifier.verify(token)
    try:
        revoked = await is_access_token_revoked(token)
    except Exception as exc:
        if get_settings().env in {"prod", "staging"}:
            raise InvalidTokenError("Token revocation status could not be verified.") from exc
        revoked = False
    if revoked:
        raise InvalidTokenError("Token has been revoked.")
    return store_request_auth_context(request, context)


async def resolve_request_access_state(
    request: Request,
    auth_context: RequestAuthContext,
    *,
    identity_service,
) -> RequestAuthContext:
    account_state, capability_state = await identity_service.resolve_access_state(auth_context)
    enriched = auth_context.with_account_state(account_state).with_capability_state(capability_state)
    store_request_auth_context(request, enriched)
    request.state.capability_state = capability_state
    return enriched
