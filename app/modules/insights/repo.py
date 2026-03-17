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
