from __future__ import annotations

from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class SourcesRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository, anon_key: str | None):
        self.supabase_repo = supabase_repo
        self.anon_key = anon_key

    def _user_headers(self, access_token: str | None, *, include_content_type: bool = True) -> dict[str, str]:
        if not access_token:
            return self.supabase_repo.headers(include_content_type=include_content_type)
        return build_user_headers(
            anon_key=self.anon_key,
            access_token=access_token,
            include_content_type=include_content_type,
        )

    async def get_source_by_fingerprint(self, *, fingerprint: str) -> dict | None:
        response = await self.supabase_repo.get(
            "sources",
            params={"fingerprint": f"eq.{fingerprint}", "select": "*", "limit": "1"},
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        return first_row(response_json(response))

    async def get_sources_by_ids(self, *, source_ids: list[str], access_token: str | None) -> list[dict]:
        if not source_ids:
            return []
        response = await self.supabase_repo.get(
            "sources",
            params={"id": f"in.({','.join(source_ids)})", "select": "*"},
            headers=self._user_headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def create_source(self, payload: dict) -> dict | None:
        response = await self.supabase_repo.post(
            "sources",
            json=payload,
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def list_visible_sources(
        self,
        *,
        user_id: str,
        access_token: str | None,
        source_type: str | None,
        hostname: str | None,
        limit: int,
    ) -> list[dict]:
        citation_params = {
            "user_id": f"eq.{user_id}",
            "select": "source_id",
            "order": "created_at.desc",
            "limit": str(limit),
        }
        response = await self.supabase_repo.get(
            "citation_instances",
            params=citation_params,
            headers=self._user_headers(access_token, include_content_type=False),
        )
        citation_rows = response_json(response)
        if not isinstance(citation_rows, list):
            return []
        source_ids: list[str] = []
        seen: set[str] = set()
        for row in citation_rows:
            source_id = row.get("source_id")
            if not source_id or source_id in seen:
                continue
            seen.add(source_id)
            source_ids.append(source_id)
        if not source_ids:
            return []
        params = {"id": f"in.({','.join(source_ids)})", "select": "*"}
        if source_type:
            params["source_type"] = f"eq.{source_type}"
        if hostname:
            params["hostname"] = f"eq.{hostname.lower()}"
        source_response = await self.supabase_repo.get(
            "sources",
            params=params,
            headers=self._user_headers(access_token, include_content_type=False),
        )
        payload = response_json(source_response)
        if not isinstance(payload, list):
            return []
        by_id = {row.get("id"): row for row in payload if row.get("id")}
        return [by_id[source_id] for source_id in source_ids if source_id in by_id]

    async def count_citations_for_sources(self, *, user_id: str, access_token: str | None, source_ids: list[str]) -> dict[str, int]:
        if not source_ids:
            return {}
        response = await self.supabase_repo.get(
            "citation_instances",
            params={
                "user_id": f"eq.{user_id}",
                "source_id": f"in.({','.join(source_ids)})",
                "select": "source_id",
                "limit": "500",
            },
            headers=self._user_headers(access_token, include_content_type=False),
        )
        rows = response_json(response)
        counts: dict[str, int] = {}
        if isinstance(rows, list):
            for row in rows:
                source_id = row.get("source_id")
                if not source_id:
                    continue
                counts[source_id] = counts.get(source_id, 0) + 1
        return counts
