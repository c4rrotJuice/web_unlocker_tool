from __future__ import annotations

from datetime import date
from typing import Any

from app.services.supabase_rest import SupabaseRestRepository, response_json


class InsightsRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository):
        self.supabase_repo = supabase_repo

    async def count_unlock_events(self, *, user_id: str, start_at: str, end_at: str, event_type: str | None = None) -> int:
        response = await self.supabase_repo.get(
            "unlock_events",
            params={
                "user_id": f"eq.{user_id}",
                "select": "id",
                "and": f"(created_at.gte.{start_at},created_at.lt.{end_at}{',event_type.eq.' + event_type if event_type else ''})",
            },
            headers=self.supabase_repo.headers(prefer="count=exact", include_content_type=False),
        )
        content_range = response.headers.get("content-range", "0-0/0")
        return int(content_range.split("/")[-1])

    async def count_documents_updated(self, *, user_id: str, start_at: str, end_at: str) -> int:
        response = await self.supabase_repo.get(
            "documents",
            params={
                "user_id": f"eq.{user_id}",
                "select": "id",
                "and": f"(updated_at.gte.{start_at},updated_at.lt.{end_at})",
            },
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

    async def get_monthly_domain_counts(self, *, user_id: str, month_start: date, month_end: date) -> list[dict[str, Any]]:
        response = await self.supabase_repo.rpc(
            "get_monthly_domain_counts",
            json={
                "p_user_id": user_id,
                "p_month_start": month_start.isoformat(),
                "p_month_end": month_end.isoformat(),
            },
            headers=self.supabase_repo.headers(),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_monthly_citation_breakdown(self, *, user_id: str, month_start: date, month_end: date) -> list[dict[str, Any]]:
        response = await self.supabase_repo.rpc(
            "get_monthly_citation_breakdown",
            json={
                "p_user_id": user_id,
                "p_month_start": month_start.isoformat(),
                "p_month_end": month_end.isoformat(),
            },
            headers=self.supabase_repo.headers(),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_milestones(self, *, user_id: str, month_start: str | None = None, month_end: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "user_id": f"eq.{user_id}",
            "select": "id,milestone_key,awarded_at,metadata",
            "order": "awarded_at.desc",
        }
        if month_start and month_end:
            params["and"] = f"(awarded_at.gte.{month_start},awarded_at.lt.{month_end})"
        response = await self.supabase_repo.get(
            "user_milestones",
            params=params,
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def insert_activity_event(self, *, payload: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        response = await self.supabase_repo.post(
            "activity_events",
            json=payload,
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            rows = response_json(response)
            return False, rows[0] if isinstance(rows, list) and rows else None
        if response.status_code == 409:
            existing = await self.get_activity_event_by_idempotency_key(
                user_id=str(payload.get("user_id")),
                idempotency_key=str(payload.get("idempotency_key") or ""),
            )
            return True, existing
        return False, None

    async def get_activity_event_by_idempotency_key(self, *, user_id: str, idempotency_key: str) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        response = await self.supabase_repo.get(
            "activity_events",
            params={
                "user_id": f"eq.{user_id}",
                "idempotency_key": f"eq.{idempotency_key}",
                "select": "id,user_id,event_type,entity_id,created_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None

    async def get_daily_activity(self, *, user_id: str, activity_date: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "user_daily_activity",
            params={
                "user_id": f"eq.{user_id}",
                "date": f"eq.{activity_date}",
                "select": "user_id,date,activity_score,actions_count,last_event_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None

    async def upsert_daily_activity(
        self,
        *,
        user_id: str,
        activity_date: str,
        activity_score: int,
        actions_count: int,
        last_event_at: str,
    ) -> dict[str, Any] | None:
        response = await self.supabase_repo.post(
            "user_daily_activity",
            params={"on_conflict": "user_id,date"},
            json={
                "user_id": user_id,
                "date": activity_date,
                "activity_score": activity_score,
                "actions_count": actions_count,
                "last_event_at": last_event_at,
            },
            headers=self.supabase_repo.headers(prefer="resolution=merge-duplicates,return=representation"),
        )
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None

    async def get_activity_state(self, *, user_id: str) -> dict[str, Any] | None:
        response = await self.supabase_repo.get(
            "user_activity_state",
            params={
                "user_id": f"eq.{user_id}",
                "select": "user_id,current_streak,longest_streak,last_active_date,updated_at",
                "limit": "1",
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None

    async def upsert_activity_state(
        self,
        *,
        user_id: str,
        current_streak: int,
        longest_streak: int,
        last_active_date: str | None,
        updated_at: str,
    ) -> dict[str, Any] | None:
        response = await self.supabase_repo.post(
            "user_activity_state",
            params={"on_conflict": "user_id"},
            json={
                "user_id": user_id,
                "current_streak": current_streak,
                "longest_streak": longest_streak,
                "last_active_date": last_active_date,
                "updated_at": updated_at,
            },
            headers=self.supabase_repo.headers(prefer="resolution=merge-duplicates,return=representation"),
        )
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None

    async def list_daily_activity(self, *, user_id: str, start_date: str, end_date: str, limit: int = 90) -> list[dict[str, Any]]:
        response = await self.supabase_repo.get(
            "user_daily_activity",
            params={
                "user_id": f"eq.{user_id}",
                "date": f"gte.{start_date}",
                "date.lt": end_date,
                "select": "user_id,date,activity_score,actions_count,last_event_at",
                "order": "date.desc",
                "limit": str(limit),
            },
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        rows = response_json(response)
        return rows if isinstance(rows, list) else []

    async def count_activity_events(self, *, user_id: str, event_type: str) -> int:
        response = await self.supabase_repo.get(
            "activity_events",
            params={
                "user_id": f"eq.{user_id}",
                "event_type": f"eq.{event_type}",
                "select": "id",
            },
            headers=self.supabase_repo.headers(prefer="count=exact", include_content_type=False),
        )
        content_range = response.headers.get("content-range", "0-0/0")
        return int(content_range.split("/")[-1])

    async def count_documents_for_user(self, *, user_id: str) -> int:
        response = await self.supabase_repo.get(
            "documents",
            params={"user_id": f"eq.{user_id}", "select": "id"},
            headers=self.supabase_repo.headers(prefer="count=exact", include_content_type=False),
        )
        content_range = response.headers.get("content-range", "0-0/0")
        return int(content_range.split("/")[-1])

    async def count_document_citations_for_user(self, *, user_id: str) -> int:
        response = await self.supabase_repo.get(
            "document_citations",
            params={"user_id": f"eq.{user_id}", "select": "document_id"},
            headers=self.supabase_repo.headers(prefer="count=exact", include_content_type=False),
        )
        content_range = response.headers.get("content-range", "0-0/0")
        return int(content_range.split("/")[-1])

    async def insert_milestone(self, *, user_id: str, milestone_key: str, metadata: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        response = await self.supabase_repo.post(
            "user_milestones",
            json={"user_id": user_id, "milestone_key": milestone_key, "metadata": metadata},
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            rows = response_json(response)
            return True, rows[0] if isinstance(rows, list) and rows else None
        if response.status_code == 409:
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
        rows = response_json(response)
        if isinstance(rows, list) and rows:
            return rows[0]
        return None
