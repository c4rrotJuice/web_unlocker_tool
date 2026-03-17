from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.modules.common.relation_validation import extract_rpc_payload
from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class WorkspaceRepository:
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

    async def create_document(self, *, user_id: str, access_token: str | None, payload: dict[str, Any]) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "documents",
            json={
                "user_id": user_id,
                "title": payload.get("title") or "Untitled",
                "content_delta": payload.get("content_delta") or {"ops": [{"insert": "\n"}]},
                "content_html": payload.get("content_html"),
                "project_id": payload.get("project_id"),
                "status": "active",
                "archived_at": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def list_documents(
        self,
        *,
        user_id: str,
        access_token: str | None,
        project_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        summary_only: bool = False,
    ) -> list[dict]:
        select = "id,title,project_id,status,archived_at,created_at,updated_at" if summary_only else "id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at"
        params = {
            "user_id": f"eq.{user_id}",
            "select": select,
            "order": "updated_at.desc,id.desc",
            "limit": str(limit),
        }
        if project_id:
            params["project_id"] = f"eq.{project_id}"
        if status:
            params["status"] = f"eq.{status}"
        response = await self.supabase_repo.get("documents", params=params, headers=self._headers(access_token, include_content_type=False))
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_document(self, *, user_id: str, access_token: str | None, document_id: str) -> dict | None:
        response = await self.supabase_repo.get(
            "documents",
            params={
                "id": f"eq.{document_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at",
                "limit": "1",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        return first_row(response_json(response))

    async def update_document(self, *, user_id: str, access_token: str | None, document_id: str, payload: dict[str, Any]) -> dict | None:
        patch_payload = {**payload, "updated_at": datetime.now(timezone.utc).isoformat()}
        response = await self.supabase_repo.patch(
            "documents",
            params={
                "id": f"eq.{document_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,content_delta,content_html,project_id,status,archived_at,created_at,updated_at",
            },
            json=patch_payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_document(self, *, user_id: str, access_token: str | None, document_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "documents",
            params={"id": f"eq.{document_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_relation_rows(self, *, table: str, user_id: str, access_token: str | None, document_ids: list[str]) -> list[dict]:
        if not document_ids:
            return []
        params = {"user_id": f"eq.{user_id}", "document_id": f"in.({','.join(document_ids)})"}
        if table == "document_citations":
            params.update({"select": "document_id,citation_id,attached_at", "order": "attached_at.asc,citation_id.asc"})
        elif table == "document_notes":
            params.update({"select": "document_id,note_id,attached_at", "order": "attached_at.asc,note_id.asc"})
        else:
            params.update({"select": "document_id,tag_id,created_at", "order": "created_at.asc,tag_id.asc"})
        response = await self.supabase_repo.get(table, params=params, headers=self._headers(access_token, include_content_type=False))
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def create_checkpoint(self, *, user_id: str, access_token: str | None, document_id: str, label: str | None, content_delta: dict, content_html: str | None) -> dict | None:
        response = await self.supabase_repo.post(
            "document_checkpoints",
            json={
                "document_id": document_id,
                "user_id": user_id,
                "label": label,
                "content_delta": content_delta,
                "content_html": content_html,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def list_checkpoints(self, *, user_id: str, access_token: str | None, document_id: str, limit: int = 10) -> list[dict]:
        response = await self.supabase_repo.get(
            "document_checkpoints",
            params={
                "document_id": f"eq.{document_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,document_id,label,content_delta,content_html,created_at",
                "order": "created_at.desc,id.desc",
                "limit": str(limit),
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_checkpoint(self, *, user_id: str, access_token: str | None, document_id: str, checkpoint_id: str) -> dict | None:
        response = await self.supabase_repo.get(
            "document_checkpoints",
            params={
                "id": f"eq.{checkpoint_id}",
                "document_id": f"eq.{document_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,document_id,label,content_delta,content_html,created_at",
                "limit": "1",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        return first_row(response_json(response))

    async def call_replace_rpc(self, *, function_name: str, payload: dict[str, Any]) -> Any:
        response = await self.supabase_repo.rpc(function_name, json=payload, headers=self.supabase_repo.headers())
        return response, extract_rpc_payload(response, result_key=function_name)
