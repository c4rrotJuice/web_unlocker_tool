from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException, Request

from app.core.auth import RequestAuthContext
from app.core.entitlements import CapabilityState
from app.modules.identity.service import IdentityService
from app.services.supabase_rest import SupabaseRestRepository, response_error_code, response_error_text, response_json


@dataclass(frozen=True)
class ResearchAccessContext:
    user_id: str
    access_token: str | None
    capability_state: CapabilityState


def build_user_headers(
    *,
    anon_key: str | None,
    access_token: str | None,
    prefer: str | None = None,
    include_content_type: bool = True,
) -> dict[str, str]:
    headers = {
        "apikey": anon_key or "",
        "Authorization": f"Bearer {access_token or ''}",
    }
    if include_content_type:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    return headers


def normalize_uuid(raw_id: str | None, *, field_name: str) -> str:
    candidate = (raw_id or "").strip()
    if not candidate:
        raise HTTPException(status_code=422, detail=f"{field_name} is required")
    try:
        return str(UUID(candidate))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field_name} must be a valid UUID") from exc


def normalize_uuid_list(raw_ids: list[str], *, field_name: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_id in raw_ids:
        value = normalize_uuid(raw_id, field_name=field_name)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def is_schema_missing_response(response) -> bool:
    if response.status_code not in {400, 404}:
        return False
    detail = response_error_text(response).lower()
    return any(token in detail for token in ("column", "relation", "table", "schema cache", "function"))


def first_row(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list) and payload:
        first = payload[0]
        return first if isinstance(first, dict) else None
    if isinstance(payload, dict):
        return payload
    return None


def ensure_response_ok(response, *, detail: str, allowed: set[int] | tuple[int, ...] = (200,)) -> Any:
    if response.status_code not in set(allowed):
        raise HTTPException(status_code=500, detail=detail)
    return response_json(response)


def raise_for_write_failure(
    response,
    *,
    detail: str,
    not_found_detail: str | None = None,
    forbidden_detail: str | None = None,
    missing_schema_detail: str | None = None,
) -> None:
    if missing_schema_detail and is_schema_missing_response(response):
        raise HTTPException(status_code=503, detail=missing_schema_detail)
    error_code = response_error_code(response)
    error_detail = response_error_text(response).lower()
    if not_found_detail and (response.status_code == 404 or "not_found" in error_detail):
        raise HTTPException(status_code=404, detail=not_found_detail)
    if forbidden_detail and (response.status_code == 403 or error_code == "42501"):
        raise HTTPException(status_code=403, detail=forbidden_detail)
    raise HTTPException(status_code=500, detail=detail)


async def load_capability_state_from_request(
    request: Request,
    auth_context: RequestAuthContext,
    *,
    identity_service: IdentityService,
) -> ResearchAccessContext:
    account_state, capability_state = await identity_service.resolve_access_state(auth_context)
    request.state.auth_context = auth_context.with_account_state(account_state).with_capability_state(capability_state)
    request.state.capability_state = capability_state
    return ResearchAccessContext(
        user_id=auth_context.user_id,
        access_token=auth_context.access_token,
        capability_state=capability_state,
    )


async def rpc(
    repository: SupabaseRestRepository,
    function_name: str,
    payload: dict[str, Any],
    *,
    detail: str,
    missing_schema_detail: str,
):
    response = await repository.rpc(function_name, json=payload, headers=repository.headers())
    if response.status_code != 200:
        raise_for_write_failure(
            response,
            detail=detail,
            missing_schema_detail=missing_schema_detail,
        )
    return response_json(response)
