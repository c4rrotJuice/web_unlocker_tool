from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.modules.research.common import normalize_uuid
from app.services.supabase_rest import response_json


def _first_row(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list) and payload:
        first = payload[0]
        return first if isinstance(first, dict) else None
    if isinstance(payload, dict):
        return payload
    return None


class OwnershipValidator:
    def __init__(self, *, supabase_repo, anon_key: str | None):
        self.supabase_repo = supabase_repo
        self.anon_key = anon_key

    async def load_owned_row(
        self,
        *,
        table: str,
        user_id: str,
        entity_id: str,
        field_name: str,
        select: str,
        access_token: str | None,
        not_found_detail: str,
    ) -> dict[str, Any]:
        normalized_id = normalize_uuid(entity_id, field_name=field_name)
        response = await self.supabase_repo.get(
            table,
            params={"id": f"eq.{normalized_id}", "user_id": f"eq.{user_id}", "select": select, "limit": "1"},
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        row = _first_row(response_json(response))
        if row is None:
            raise HTTPException(status_code=404, detail=not_found_detail)
        return row

    async def load_owned_document(self, *, user_id: str, document_id: str, access_token: str | None, select: str) -> dict[str, Any]:
        return await self.load_owned_row(
            table="documents",
            user_id=user_id,
            entity_id=document_id,
            field_name="document_id",
            select=select,
            access_token=access_token,
            not_found_detail="Document not found",
        )

    async def load_owned_note(self, *, user_id: str, note_id: str, access_token: str | None, select: str) -> dict[str, Any]:
        return await self.load_owned_row(
            table="notes",
            user_id=user_id,
            entity_id=note_id,
            field_name="note_id",
            select=select,
            access_token=access_token,
            not_found_detail="Note not found",
        )

    async def load_owned_quote(self, *, user_id: str, quote_id: str, access_token: str | None, select: str) -> dict[str, Any]:
        return await self.load_owned_row(
            table="quotes",
            user_id=user_id,
            entity_id=quote_id,
            field_name="quote_id",
            select=select,
            access_token=access_token,
            not_found_detail="Quote not found",
        )
