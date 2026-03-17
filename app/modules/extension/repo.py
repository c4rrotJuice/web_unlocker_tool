from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

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
