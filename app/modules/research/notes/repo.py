from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.modules.common.relation_validation import extract_rpc_payload
from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class NotesRepository:
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

    async def create_note(self, *, user_id: str, access_token: str | None, payload: dict[str, Any]) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "notes",
            json={
                "id": str(uuid4()),
                "user_id": user_id,
                "title": payload["title"],
                "note_body": payload["note_body"],
                "highlight_text": payload.get("highlight_text"),
                "project_id": payload.get("project_id"),
                "citation_id": payload.get("citation_id"),
                "quote_id": payload.get("quote_id"),
                "status": "active",
                "archived_at": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def list_notes(
        self,
        *,
        user_id: str,
        access_token: str | None,
        project_id: str | None = None,
        citation_id: str | None = None,
        quote_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        params = {
            "user_id": f"eq.{user_id}",
            "select": "id,title,note_body,highlight_text,project_id,citation_id,quote_id,status,archived_at,created_at,updated_at",
            "order": "updated_at.desc,id.desc",
            "limit": str(limit),
        }
        if project_id:
            params["project_id"] = f"eq.{project_id}"
        if citation_id:
            params["citation_id"] = f"eq.{citation_id}"
        if quote_id:
            params["quote_id"] = f"eq.{quote_id}"
        if status:
            params["status"] = f"eq.{status}"
        if query:
            params["search_vector"] = f"plfts.{query}"
        response = await self.supabase_repo.get("notes", params=params, headers=self._headers(access_token, include_content_type=False))
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_notes_by_ids(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        if not note_ids:
            return []
        response = await self.supabase_repo.get(
            "notes",
            params={
                "user_id": f"eq.{user_id}",
                "id": f"in.({','.join(note_ids)})",
                "select": "id,title,note_body,highlight_text,project_id,citation_id,quote_id,status,archived_at,created_at,updated_at",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_note(self, *, user_id: str, access_token: str | None, note_id: str) -> dict | None:
        rows = await self.list_notes_by_ids(user_id=user_id, access_token=access_token, note_ids=[note_id])
        return rows[0] if rows else None

    async def update_note(self, *, user_id: str, access_token: str | None, note_id: str, payload: dict[str, Any]) -> dict | None:
        patch_payload = {**payload, "updated_at": datetime.now(timezone.utc).isoformat()}
        response = await self.supabase_repo.patch(
            "notes",
            params={
                "id": f"eq.{note_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,note_body,highlight_text,project_id,citation_id,quote_id,status,archived_at,created_at,updated_at",
            },
            json=patch_payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_note(self, *, user_id: str, access_token: str | None, note_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "notes",
            params={"id": f"eq.{note_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_tag_links(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        if not note_ids:
            return []
        response = await self.supabase_repo.get(
            "note_tag_links",
            params={
                "user_id": f"eq.{user_id}",
                "note_id": f"in.({','.join(note_ids)})",
                "select": "note_id,tag_id,created_at",
                "order": "created_at.asc,tag_id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_sources(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        if not note_ids:
            return []
        response = await self.supabase_repo.get(
            "note_sources",
            params={
                "user_id": f"eq.{user_id}",
                "note_id": f"in.({','.join(note_ids)})",
                "select": "id,note_id,source_id,citation_id,relation_type,url,hostname,title,source_author,source_published_at,attached_at,position",
                "order": "position.asc,attached_at.asc,id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_sources_by_source_ids(self, *, user_id: str, access_token: str | None, source_ids: list[str]) -> list[dict]:
        if not source_ids:
            return []
        response = await self.supabase_repo.get(
            "note_sources",
            params={
                "user_id": f"eq.{user_id}",
                "source_id": f"in.({','.join(source_ids)})",
                "select": "id,note_id,source_id,citation_id,relation_type,url,hostname,title,source_author,source_published_at,attached_at,position",
                "order": "position.asc,attached_at.asc,id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_sources_by_citation_ids(self, *, user_id: str, access_token: str | None, citation_ids: list[str]) -> list[dict]:
        if not citation_ids:
            return []
        response = await self.supabase_repo.get(
            "note_sources",
            params={
                "user_id": f"eq.{user_id}",
                "citation_id": f"in.({','.join(citation_ids)})",
                "select": "id,note_id,source_id,citation_id,relation_type,url,hostname,title,source_author,source_published_at,attached_at,position",
                "order": "position.asc,attached_at.asc,id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_note_links(self, *, user_id: str, access_token: str | None, note_ids: list[str]) -> list[dict]:
        if not note_ids:
            return []
        response = await self.supabase_repo.get(
            "note_links",
            params={
                "user_id": f"eq.{user_id}",
                "note_id": f"in.({','.join(note_ids)})",
                "select": "note_id,linked_note_id,created_at",
                "order": "created_at.asc,linked_note_id.asc",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def call_replace_rpc(self, *, function_name: str, payload: dict[str, Any]) -> Any:
        response = await self.supabase_repo.rpc(function_name, json=payload, headers=self.supabase_repo.headers())
        return response, extract_rpc_payload(response, result_key=function_name)
