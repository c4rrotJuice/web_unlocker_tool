from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from app.modules.research.common import first_row
from app.services.supabase_rest import SupabaseRestRepository, response_error_code, response_json


class UnlockRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository):
        self.supabase_repo = supabase_repo

    async def insert_activity_event(self, *, payload: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        response = await self.supabase_repo.post(
            "unlock_events",
            json=payload,
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            return False, first_row(response_json(response))
        if response_error_code(response) == "23505":
            existing = await self.get_event_by_event_id(
                user_id=payload.get("user_id"),
                event_id=payload.get("event_id"),
            )
            return True, existing
        return False, None

    async def get_event_by_event_id(self, *, user_id: str | None, event_id: str | None) -> dict[str, Any] | None:
        if not user_id or not event_id:
            return None
        response = await self.supabase_repo.get(
            "unlock_events",
            params={
                "user_id": f"eq.{user_id}",
                "event_id": f"eq.{event_id}",
                "select": "id,user_id,url,domain,source,event_type,event_id,was_cleaned,created_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def list_activity_events(
        self,
        *,
        user_id: str,
        limit: int,
        direction: str,
        event_type: str | None,
        domain: str | None,
        cursor_created_at: str | None,
        cursor_id: str | None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "user_id": f"eq.{user_id}",
            "select": "id,url,domain,source,event_type,was_cleaned,created_at",
            "order": f"created_at.{direction},id.{direction}",
            "limit": str(limit),
        }
        if event_type:
            params["event_type"] = f"eq.{event_type}"
        if domain:
            params["domain"] = f"eq.{domain}"
        if cursor_created_at and cursor_id:
            comparator = "lt" if direction == "desc" else "gt"
            params["or"] = (
                f"(created_at.{comparator}.{cursor_created_at},"
                f"and(created_at.eq.{cursor_created_at},id.{comparator}.{cursor_id}))"
            )
        response = await self.supabase_repo.get(
            "unlock_events",
            params=params,
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def count_unlock_events(self, *, user_id: str, event_type: str | None = None, start_at: str | None = None, end_at: str | None = None) -> int:
        params: dict[str, str] = {
            "user_id": f"eq.{user_id}",
            "select": "id",
        }
        clauses: list[str] = []
        if start_at:
            clauses.append(f"created_at.gte.{start_at}")
        if end_at:
            clauses.append(f"created_at.lt.{end_at}")
        if event_type:
            clauses.append(f"event_type.eq.{event_type}")
        if clauses:
            params["and"] = f"({','.join(clauses)})"
        response = await self.supabase_repo.get(
            "unlock_events",
            params=params,
            headers=self.supabase_repo.headers(prefer="count=exact", include_content_type=False),
        )
        content_range = response.headers.get("content-range", "0-0/0")
        return int(content_range.split("/")[-1])

    async def get_unlock_days(self, *, user_id: str, start_date: date, end_date: date) -> list[date]:
        response = await self.supabase_repo.rpc(
            "get_unlock_days",
            json={
                "p_user_id": user_id,
                "p_start_date": start_date.isoformat(),
                "p_end_date": end_date.isoformat(),
            },
            headers=self.supabase_repo.headers(),
        )
        payload = response_json(response)
        days: list[date] = []
        if isinstance(payload, list):
            for item in payload:
                raw_day = item.get("unlock_day") or item.get("day")
                if isinstance(raw_day, str):
                    days.append(date.fromisoformat(raw_day))
        return days

    async def list_milestones(self, *, user_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "user_id": f"eq.{user_id}",
            "select": "id,milestone_key,awarded_at,metadata",
            "order": "awarded_at.desc",
        }
        if limit is not None:
            params["limit"] = str(limit)
        response = await self.supabase_repo.get(
            "user_milestones",
            params=params,
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def insert_milestone(self, *, user_id: str, milestone_key: str, metadata: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        response = await self.supabase_repo.post(
            "user_milestones",
            json={
                "user_id": user_id,
                "milestone_key": milestone_key,
                "metadata": metadata,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            return True, first_row(response_json(response))
        if response_error_code(response) == "23505":
            existing = await self.get_milestone(user_id=user_id, milestone_key=milestone_key)
            return False, existing
        return False, None

    async def get_milestone(self, *, user_id: str, milestone_key: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "user_milestones",
            params={
                "user_id": f"eq.{user_id}",
                "milestone_key": f"eq.{milestone_key}",
                "select": "id,milestone_key,awarded_at,metadata",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def list_bookmarks(
        self,
        *,
        user_id: str,
        limit: int,
        direction: str,
        cursor_created_at: str | None,
        cursor_id: str | None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "user_id": f"eq.{user_id}",
            "select": "id,url,domain,title,saved_from,created_at",
            "order": f"created_at.{direction},id.{direction}",
            "limit": str(limit),
        }
        if cursor_created_at and cursor_id:
            comparator = "lt" if direction == "desc" else "gt"
            params["or"] = (
                f"(created_at.{comparator}.{cursor_created_at},"
                f"and(created_at.eq.{cursor_created_at},id.{comparator}.{cursor_id}))"
            )
        response = await self.supabase_repo.get(
            "bookmarks",
            params=params,
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def find_bookmark_by_url(self, *, user_id: str, url: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "bookmarks",
            params={
                "user_id": f"eq.{user_id}",
                "url": f"eq.{url}",
                "select": "id,url,domain,title,saved_from,created_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def insert_bookmark(self, *, payload: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        response = await self.supabase_repo.post(
            "bookmarks",
            json=payload,
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            return True, first_row(response_json(response))
        if response_error_code(response) == "23505":
            existing = await self.find_bookmark_by_url(user_id=str(payload["user_id"]), url=str(payload["url"]))
            return False, existing
        return False, None

    async def delete_bookmark(self, *, user_id: str, bookmark_id: str) -> list[dict[str, Any]]:
        response = await self.supabase_repo.delete(
            "bookmarks",
            params={
                "user_id": f"eq.{user_id}",
                "id": f"eq.{bookmark_id}",
                "select": "id,url,domain,title,saved_from,created_at",
            },
            headers=self.supabase_repo.headers(prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def upsert_guest_usage(self, *, usage_key: str, usage_date: date) -> dict[str, Any] | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "guest_unlock_usage",
            params={"on_conflict": "usage_key,usage_date"},
            json={
                "usage_key": usage_key,
                "usage_date": usage_date.isoformat(),
                "usage_count": 1,
                "updated_at": now_iso,
            },
            headers=self.supabase_repo.headers(prefer="return=representation,resolution=merge-duplicates"),
        )
        return first_row(response_json(response))
