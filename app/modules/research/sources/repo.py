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
        offset: int = 0,
    ) -> list[dict]:
        batch_size = max(limit + offset + 1, 100)
        target_count = offset + limit + 1
        source_activity: dict[str, str] = {}
        citation_offset = 0
        note_offset = 0
        citation_exhausted = False
        note_exhausted = False

        while len(source_activity) < target_count and (not citation_exhausted or not note_exhausted):
            if not citation_exhausted:
                citation_response = await self.supabase_repo.get(
                    "citation_instances",
                    params={
                        "user_id": f"eq.{user_id}",
                        "select": "source_id,created_at",
                        "order": "created_at.desc,id.desc",
                        "limit": str(batch_size),
                        "offset": str(citation_offset),
                    },
                    headers=self._user_headers(access_token, include_content_type=False),
                )
                citation_rows = response_json(citation_response)
                if not isinstance(citation_rows, list) or not citation_rows:
                    citation_exhausted = True
                else:
                    for row in citation_rows:
                        source_id = row.get("source_id")
                        activity_at = str(row.get("created_at") or "")
                        if source_id and activity_at and activity_at > source_activity.get(source_id, ""):
                            source_activity[source_id] = activity_at
                    citation_offset += len(citation_rows)
                    citation_exhausted = len(citation_rows) < batch_size

            if not note_exhausted:
                note_response = await self.supabase_repo.get(
                    "note_sources",
                    params={
                        "user_id": f"eq.{user_id}",
                        "source_id": "not.is.null",
                        "select": "source_id,attached_at",
                        "order": "attached_at.desc,id.desc",
                        "limit": str(batch_size),
                        "offset": str(note_offset),
                    },
                    headers=self._user_headers(access_token, include_content_type=False),
                )
                note_rows = response_json(note_response)
                if not isinstance(note_rows, list) or not note_rows:
                    note_exhausted = True
                else:
                    for row in note_rows:
                        source_id = row.get("source_id")
                        activity_at = str(row.get("attached_at") or "")
                        if source_id and activity_at and activity_at > source_activity.get(source_id, ""):
                            source_activity[source_id] = activity_at
                    note_offset += len(note_rows)
                    note_exhausted = len(note_rows) < batch_size

            if citation_exhausted and note_exhausted:
                break

        if not source_activity:
            return []
        ordered_source_ids = [
            source_id
            for source_id, _activity_at in sorted(
                source_activity.items(),
                key=lambda item: (item[1], item[0]),
                reverse=True,
            )
        ]
        params = {"id": f"in.({','.join(ordered_source_ids)})", "select": "*"}
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
        filtered_ids = [source_id for source_id in ordered_source_ids if source_id in by_id]
        page_ids = filtered_ids[offset:offset + limit]
        return [by_id[source_id] for source_id in page_ids]

    async def count_visible_sources(
        self,
        *,
        user_id: str,
        access_token: str | None,
        source_type: str | None,
        hostname: str | None,
    ) -> int:
        rows = await self.list_visible_sources(
            user_id=user_id,
            access_token=access_token,
            source_type=source_type,
            hostname=hostname,
            limit=10000,
            offset=0,
        )
        return len(rows)

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
