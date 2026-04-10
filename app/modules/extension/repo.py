from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.security import hit_shared_auth_rate_limit
from app.modules.research.common import first_row
from app.services.supabase_rest import SupabaseRestRepository, response_error_code, response_json


class ExtensionRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository):
        self.supabase_repo = supabase_repo

    async def create_handoff_code(
        self,
        *,
        code: str,
        user_id: str,
        redirect_path: str,
        session_payload: dict[str, Any],
        expires_at: str,
    ) -> dict[str, Any] | None:
        response = await self.supabase_repo.post(
            "auth_handoff_codes",
            json={
                "code": code,
                "user_id": user_id,
                "redirect_path": redirect_path,
                "session_payload": session_payload,
                "expires_at": expires_at,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def hit_auth_rate_limit(
        self,
        *,
        scope: str,
        identity: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int]:
        return await hit_shared_auth_rate_limit(
            scope=scope,
            identity=identity,
            limit=limit,
            window_seconds=window_seconds,
        )

    async def record_revoked_access_token(self, *, access_token: str, user_id: str, expires_at: str | None) -> None:
        token_hash = hashlib.sha256(access_token.encode("utf-8")).hexdigest()
        await self.supabase_repo.post(
            "revoked_auth_tokens",
            json={
                "token_hash": token_hash,
                "user_id": user_id,
                "expires_at": expires_at,
            },
            headers=self.supabase_repo.headers(prefer="resolution=merge-duplicates,return=minimal"),
        )

    async def create_handoff_attempt(
        self,
        *,
        attempt_id: str,
        attempt_secret_hash: str,
        redirect_path: str,
        expires_at: str,
    ) -> dict[str, Any] | None:
        response = await self.supabase_repo.post(
            "auth_handoff_attempts",
            json={
                "attempt_id": attempt_id,
                "attempt_secret_hash": attempt_secret_hash,
                "status": "pending",
                "redirect_path": redirect_path,
                "expires_at": expires_at,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def get_handoff_attempt(self, *, attempt_id: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "auth_handoff_attempts",
            params={
                "attempt_id": f"eq.{attempt_id}",
                "select": "id,attempt_id,attempt_secret_hash,status,redirect_path,expires_at,user_id,handoff_code,ready_at,exchanged_at,created_at,updated_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def mark_handoff_attempt_ready(
        self,
        *,
        attempt_id: str,
        user_id: str,
        handoff_code: str,
        ready_at: str,
    ) -> dict[str, Any] | None:
        response = await self.supabase_repo.patch(
            "auth_handoff_attempts",
            params={
                "attempt_id": f"eq.{attempt_id}",
                "status": "eq.pending",
                "select": "id,attempt_id,attempt_secret_hash,status,redirect_path,expires_at,user_id,handoff_code,ready_at,exchanged_at,created_at,updated_at",
            },
            json={
                "status": "ready",
                "user_id": user_id,
                "handoff_code": handoff_code,
                "ready_at": ready_at,
                "updated_at": ready_at,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def mark_handoff_attempt_exchanged(self, *, handoff_code: str, exchanged_at: str) -> None:
        await self.supabase_repo.patch(
            "auth_handoff_attempts",
            params={"handoff_code": f"eq.{handoff_code}"},
            json={
                "status": "exchanged",
                "exchanged_at": exchanged_at,
                "updated_at": exchanged_at,
            },
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def get_handoff_code(self, *, code: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "auth_handoff_codes",
            params={
                "code": f"eq.{code}",
                "select": "id,code,user_id,redirect_path,session_payload,expires_at,used_at,created_at,refresh_token,expires_in,token_type",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def consume_handoff_code(self, *, record_id: str, used_at: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.patch(
            "auth_handoff_codes",
            params={
                "id": f"eq.{record_id}",
                "used_at": "is.null",
                "select": "id,code,user_id,redirect_path,session_payload,expires_at,used_at,created_at,refresh_token,expires_in,token_type",
            },
            json={"used_at": used_at},
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def clear_handoff_session_payload(self, *, record_id: str) -> None:
        await self.supabase_repo.patch(
            "auth_handoff_codes",
            params={"id": f"eq.{record_id}"},
            json={"session_payload": {}},
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def invalidate_handoff_code(self, *, record_id: str, used_at: str) -> None:
        await self.supabase_repo.patch(
            "auth_handoff_codes",
            params={"id": f"eq.{record_id}", "used_at": "is.null"},
            json={"used_at": used_at, "session_payload": {}},
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def delete_expired_handoff_codes(self, *, cleanup_grace_window_minutes: int = 10) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=cleanup_grace_window_minutes)).isoformat()
        response = await self.supabase_repo.delete(
            "auth_handoff_codes",
            params={
                "expires_at": f"lt.{cutoff}",
                "select": "id",
            },
            headers=self.supabase_repo.headers(prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        if isinstance(payload, list):
            return len(payload)
        return 0

    async def delete_expired_handoff_attempts(self, *, cleanup_grace_window_minutes: int = 10) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=cleanup_grace_window_minutes)).isoformat()
        response = await self.supabase_repo.delete(
            "auth_handoff_attempts",
            params={
                "expires_at": f"lt.{cutoff}",
                "select": "id",
            },
            headers=self.supabase_repo.headers(prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        if isinstance(payload, list):
            return len(payload)
        return 0

    async def insert_unlock_event(
        self,
        *,
        user_id: str,
        url: str,
        domain: str,
        event_type: str,
        event_id: str,
        was_cleaned: bool,
    ) -> tuple[bool, dict[str, Any] | None]:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "unlock_events",
            json={
                "user_id": user_id,
                "url": url,
                "domain": domain,
                "source": "extension",
                "event_type": event_type,
                "event_id": event_id,
                "was_cleaned": was_cleaned,
                "created_at": now_iso,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            return False, first_row(response_json(response))
        if response_error_code(response) == "23505":
            return True, None
        return False, None
