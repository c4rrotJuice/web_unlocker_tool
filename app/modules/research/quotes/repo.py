from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class QuotesRepository:
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

    async def list_quotes(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str | None = None,
        citation_ids: list[str] | None = None,
        quote_ids: list[str] | None = None,
        query: str | None = None,
        limit: int = 50,
        order: str = "created_at.desc,id.desc",
    ) -> list[dict]:
        params = {
            "user_id": f"eq.{user_id}",
            "select": "id,citation_id,excerpt,locator,annotation,created_at,updated_at",
            "order": order,
            "limit": str(limit),
        }
        if citation_id:
            params["citation_id"] = f"eq.{citation_id}"
        if citation_ids:
            params["citation_id"] = f"in.({','.join(citation_ids)})"
        if quote_ids:
            params["id"] = f"in.({','.join(quote_ids)})"
            params.pop("limit", None)
            params.pop("order", None)
        if query and query.strip():
            needle = query.strip().replace("*", "")
            if needle:
                params["excerpt"] = f"ilike.*{needle}*"
        response = await self.supabase_repo.get("quotes", params=params, headers=self._headers(access_token, include_content_type=False))
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_quote(self, *, user_id: str, access_token: str | None, quote_id: str) -> dict | None:
        rows = await self.list_quotes(user_id=user_id, access_token=access_token, quote_ids=[quote_id], limit=1)
        return rows[0] if rows else None

    async def create_quote(self, *, user_id: str, access_token: str | None, payload: dict[str, Any]) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "quotes",
            json={
                "user_id": user_id,
                "citation_id": payload["citation_id"],
                "excerpt": payload["excerpt"],
                "locator": payload.get("locator") or {},
                "annotation": payload.get("annotation"),
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def update_quote(self, *, user_id: str, access_token: str | None, quote_id: str, payload: dict[str, Any]) -> dict | None:
        patch_payload = {**payload, "updated_at": datetime.now(timezone.utc).isoformat()}
        response = await self.supabase_repo.patch(
            "quotes",
            params={
                "id": f"eq.{quote_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,citation_id,excerpt,locator,annotation,created_at,updated_at",
            },
            json=patch_payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_quote(self, *, user_id: str, access_token: str | None, quote_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "quotes",
            params={"id": f"eq.{quote_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_ids_by_quote_ids(self, *, user_id: str, access_token: str | None, quote_ids: list[str]) -> dict[str, list[str]]:
        if not quote_ids:
            return {}
        response = await self.supabase_repo.get(
            "notes",
            params={
                "user_id": f"eq.{user_id}",
                "quote_id": f"in.({','.join(quote_ids)})",
                "select": "id,quote_id",
                "order": "created_at.asc,id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        by_quote: dict[str, list[str]] = {}
        if isinstance(payload, list):
            for row in payload:
                quote_id = row.get("quote_id")
                note_id = row.get("id")
                if quote_id and note_id:
                    by_quote.setdefault(quote_id, []).append(note_id)
        return by_quote

    async def list_document_citation_links(
        self,
        *,
        user_id: str,
        access_token: str | None,
        document_id: str,
    ) -> list[dict]:
        response = await self.supabase_repo.get(
            "document_citations",
            params={
                "user_id": f"eq.{user_id}",
                "document_id": f"eq.{document_id}",
                "select": "citation_id,attached_at",
                "order": "attached_at.asc,citation_id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_quotes_for_document(
        self,
        *,
        user_id: str,
        access_token: str | None,
        document_id: str,
        query: str | None = None,
    ) -> tuple[list[str], list[dict]]:
        links = await self.list_document_citation_links(
            user_id=user_id,
            access_token=access_token,
            document_id=document_id,
        )
        citation_ids_in_order: list[str] = []
        seen_citation_ids: set[str] = set()
        for link in links:
            citation_id = link.get("citation_id")
            if citation_id and citation_id not in seen_citation_ids:
                seen_citation_ids.add(citation_id)
                citation_ids_in_order.append(citation_id)
        if not citation_ids_in_order:
            return [], []
        rows = await self.list_quotes(
            user_id=user_id,
            access_token=access_token,
            citation_ids=citation_ids_in_order,
            query=query,
            order="created_at.asc,id.asc",
        )
        return citation_ids_in_order, rows
