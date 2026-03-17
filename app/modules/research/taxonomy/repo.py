from __future__ import annotations

from datetime import datetime, timezone

from app.modules.research.common import build_user_headers, first_row
from app.services.supabase_rest import SupabaseRestRepository, response_json


class TaxonomyRepository:
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

    async def list_projects(self, *, user_id: str, access_token: str | None, include_archived: bool, limit: int) -> list[dict]:
        params = {
            "user_id": f"eq.{user_id}",
            "order": "updated_at.desc,id.desc",
            "select": "id,name,color,description,status,icon,archived_at,created_at,updated_at",
            "limit": str(limit),
        }
        if not include_archived:
            params["status"] = "eq.active"
        response = await self.supabase_repo.get("projects", params=params, headers=self._headers(access_token, include_content_type=False))
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_project(self, *, user_id: str, access_token: str | None, project_id: str) -> dict | None:
        response = await self.supabase_repo.get(
            "projects",
            params={
                "id": f"eq.{project_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,name,color,description,status,icon,archived_at,created_at,updated_at",
                "limit": "1",
            },
            headers=self._headers(access_token, include_content_type=False),
        )
        return first_row(response_json(response))

    async def create_project(self, *, user_id: str, access_token: str | None, payload: dict) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "projects",
            json={
                "user_id": user_id,
                "name": payload["name"],
                "color": payload.get("color"),
                "description": payload.get("description"),
                "icon": payload.get("icon"),
                "status": "active",
                "archived_at": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def update_project(self, *, user_id: str, access_token: str | None, project_id: str, payload: dict) -> dict | None:
        response = await self.supabase_repo.patch(
            "projects",
            params={"id": f"eq.{project_id}", "user_id": f"eq.{user_id}", "select": "id,name,color,description,status,icon,archived_at,created_at,updated_at"},
            json=payload,
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_project(self, *, user_id: str, access_token: str | None, project_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "projects",
            params={"id": f"eq.{project_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def list_tags(self, *, user_id: str, access_token: str | None) -> list[dict]:
        response = await self.supabase_repo.get(
            "tags",
            params={"user_id": f"eq.{user_id}", "order": "updated_at.desc", "select": "id,name,created_at,updated_at"},
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_tags_by_ids(self, *, user_id: str, access_token: str | None, tag_ids: list[str]) -> list[dict]:
        if not tag_ids:
            return []
        response = await self.supabase_repo.get(
            "tags",
            params={"user_id": f"eq.{user_id}", "id": f"in.({','.join(tag_ids)})", "select": "id,name,created_at,updated_at"},
            headers=self._headers(access_token, include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []

    async def get_tag_by_name(self, *, user_id: str, access_token: str | None, name: str) -> dict | None:
        response = await self.supabase_repo.get(
            "tags",
            params={"user_id": f"eq.{user_id}", "name": f"ilike.{name}", "select": "id,name,created_at,updated_at", "limit": "1"},
            headers=self._headers(access_token, include_content_type=False),
        )
        return first_row(response_json(response))

    async def create_tag(self, *, user_id: str, access_token: str | None, name: str) -> dict | None:
        now_iso = datetime.now(timezone.utc).isoformat()
        response = await self.supabase_repo.post(
            "tags",
            json={"user_id": user_id, "name": name, "created_at": now_iso, "updated_at": now_iso},
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def update_tag(self, *, user_id: str, access_token: str | None, tag_id: str, name: str) -> dict | None:
        response = await self.supabase_repo.patch(
            "tags",
            params={"id": f"eq.{tag_id}", "user_id": f"eq.{user_id}", "select": "id,name,created_at,updated_at"},
            json={"name": name},
            headers=self._headers(access_token, prefer="return=representation"),
        )
        return first_row(response_json(response))

    async def delete_tag(self, *, user_id: str, access_token: str | None, tag_id: str) -> list[dict]:
        response = await self.supabase_repo.delete(
            "tags",
            params={"id": f"eq.{tag_id}", "user_id": f"eq.{user_id}", "select": "id"},
            headers=self._headers(access_token, prefer="return=representation", include_content_type=False),
        )
        payload = response_json(response)
        return payload if isinstance(payload, list) else []
