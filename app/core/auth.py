from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Any

from fastapi import Header, Request
from supabase import create_client

from app.core.account_state import AccountState
from app.core.config import Settings, get_settings
from app.core.entitlements import CapabilityState
from app.core.errors import ExpiredTokenError, InvalidTokenError, MalformedCredentialsError, MissingCredentialsError


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


async def require_request_auth_context(
    request: Request,
    authorization: str | None = Header(default=None),
) -> RequestAuthContext:
    token = extract_bearer_token(authorization)
    verifier = get_token_verifier()
    context = verifier.verify(token)
    request.state.auth_context = context
    return context
