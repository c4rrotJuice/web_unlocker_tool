from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class CitationsRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository, anon_key: str | None):
        self.supabase_repo = supabase_repo
        self.anon_key = anon_key

    def _headers(self, access_token: str | None, *, prefer: str | None = None, include_content_type: bool = True) -> dict[str, str]:
        if not access_token:
            return self.supabase_repo.headers(prefer=prefer, include_content_type=include_content_type)
        return build_user_headers(
            anon_key=self.anon_key,
            access_token=access_token,
            prefer=prefer,
            include_content_type=include_content_type,
        )

    async def create_citation_instance(self, *, user_id: str, access_token: str | None, payload: dict[str, Any]) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "citation_instances",
            json={
                "user_id": user_id,
                "source_id": payload["source_id"],
                "locator": payload.get("locator") or {},
                "quote_text": payload.get("quote_text"),
                "excerpt": payload.get("excerpt"),
                "annotation": payload.get("annotation"),
                "citation_version": payload["citation_version"],
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def get_citation_by_source(self, *, user_id: str, access_token: str | None, source_id: str) -> dict | None:
        response = await self.supabase_repo.get(
            "citation_instances",
            params={
                "user_id": f"eq.{user_id}",
                "source_id": f"eq.{source_id}",
                "select": "id,source_id,locator,quote_text,excerpt,annotation,citation_version,created_at,updated_at",
                "limit": "1",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        return first_row(response_json(response))

    async def list_citations(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_ids: list[str] | None = None,
        source_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        params = {
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
            "select": "id,source_id,locator,quote_text,excerpt,annotation,citation_version,created_at,updated_at",
        }
        if citation_ids:
            params["id"] = f"in.({','.join(citation_ids)})"
        if source_id:
            params["source_id"] = f"eq.{source_id}"
        response = await self.supabase_repo.get(
            "citation_instances",
            params=params,
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_citation(self, *, user_id: str, access_token: str | None, citation_id: str) -> dict | None:
        rows = await self.list_citations(user_id=user_id, access_token=access_token, citation_ids=[citation_id], limit=1)
        return rows[0] if rows else None

    async def update_citation(self, *, user_id: str, access_token: str | None, citation_id: str, payload: dict[str, Any]) -> dict | None:
        response = await self.supabase_repo.patch(
            "citation_instances",
            params={"id": f"eq.{citation_id}", "user_id": f"eq.{user_id}", "select": "id,source_id,locator,quote_text,excerpt,annotation,citation_version,created_at,updated_at"},
            json=payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_citation(self, *, user_id: str, access_token: str | None, citation_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "citation_instances",
            params={"id": f"eq.{citation_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_renders(self, *, citation_ids: list[str], access_token: str | None) -> list[dict]:
        if not citation_ids:
            return []
        response = await self.supabase_repo.get(
            "citation_renders",
            params={"citation_instance_id": f"in.({','.join(citation_ids)})", "select": "citation_instance_id,style,render_kind,rendered_text,source_version,citation_version,render_version"},
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def replace_renders(self, *, citation_id: str, source_id: str, rows: list[dict[str, Any]]) -> None:
        await self.supabase_repo.delete(
            "citation_renders",
            params={"citation_instance_id": f"eq.{citation_id}"},
            headers=self.supabase_repo.headers(prefer="return=minimal", include_content_type=False),
        )
        if not rows:
            return
        await self.supabase_repo.post(
            "citation_renders",
            json=rows,
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def list_quote_counts(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> dict[str, int]:
        if not citation_ids:
            return {}
        response = await self.supabase_repo.get(
            "quotes",
            params={
                "user_id": f"eq.{user_id}",
                "citation_id": f"in.({','.join(citation_ids)})",
                "select": "citation_id",
                "limit": "500",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        rows = response_json(response)
        counts: dict[str, int] = {}
        if isinstance(rows, list):
            for row in rows:
                citation_id = row.get("citation_id")
                if not citation_id:
                    continue
                counts[citation_id] = counts.get(citation_id, 0) + 1
        return counts

    async def list_note_counts(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> dict[str, int]:
        if not citation_ids:
            return {}
        response = await self.supabase_repo.get(
            "notes",
            params={
                "user_id": f"eq.{user_id}",
                "citation_id": f"in.({','.join(citation_ids)})",
                "select": "citation_id",
                "limit": "500",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        rows = response_json(response)
        counts: dict[str, int] = {}
        if isinstance(rows, list):
            for row in rows:
                citation_id = row.get("citation_id")
                if not citation_id:
                    continue
                counts[citation_id] = counts.get(citation_id, 0) + 1
        return counts

    async def list_document_counts(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> dict[str, int]:
        if not citation_ids:
            return {}
        response = await self.supabase_repo.get(
            "document_citations",
            params={
                "user_id": f"eq.{user_id}",
                "citation_id": f"in.({','.join(citation_ids)})",
                "select": "citation_id",
                "limit": "500",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        rows = response_json(response)
        counts: dict[str, int] = {}
        if isinstance(rows, list):
            for row in rows:
                citation_id = row.get("citation_id")
                if not citation_id:
                    continue
                counts[citation_id] = counts.get(citation_id, 0) + 1
        return counts

    async def list_templates(self, *, user_id: str, access_token: str | None) -> list[dict]:
        response = await self.supabase_repo.get(
            "citation_templates",
            params={"user_id": f"eq.{user_id}", "order": "updated_at.desc", "select": "id,name,template_body,is_default,created_at,updated_at"},
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def create_template(self, *, user_id: str, access_token: str | None, payload: dict[str, Any]) -> dict | None:
        response = await self.supabase_repo.post(
            "citation_templates",
            json={"user_id": user_id, **payload},
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def update_template(self, *, user_id: str, access_token: str | None, template_id: str, payload: dict[str, Any]) -> dict | None:
        response = await self.supabase_repo.patch(
            "citation_templates",
            params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}", "select": "id,name,template_body,is_default,created_at,updated_at"},
            json=payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_template(self, *, user_id: str, access_token: str | None, template_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "citation_templates",
            params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []
