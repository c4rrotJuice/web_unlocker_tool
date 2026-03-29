from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.serialization import serialize_project, serialize_tag
from app.modules.research.common import normalize_uuid, normalize_uuid_list
from app.modules.research.taxonomy.repo import TaxonomyRepository


class TaxonomyService:
    def __init__(self, *, repository: TaxonomyRepository):
        self.repository = repository

    async def list_projects(self, *, user_id: str, access_token: str | None, include_archived: bool = True, limit: int = 24) -> list[dict]:
        rows = await self.repository.list_project_relationship_summaries(
            user_id=user_id,
            access_token=access_token,
            include_archived=include_archived,
            limit=limit,
        )
        return [
            serialize_project(
                row,
                relationship_counts=row.get("relationship_counts"),
                recent_activity=row.get("recent_activity"),
            )
            for row in rows
        ]

    async def get_project(self, *, user_id: str, access_token: str | None, project_id: str) -> dict:
        normalized_id = normalize_uuid(project_id, field_name="project_id")
        rows = await self.repository.list_project_relationship_summaries(
            user_id=user_id,
            access_token=access_token,
            project_ids=[normalized_id],
            include_archived=True,
            limit=1,
        )
        row = rows[0] if rows else None
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return serialize_project(
            row,
            relationship_counts=row.get("relationship_counts"),
            recent_activity=row.get("recent_activity"),
        )

    async def create_project(self, *, user_id: str, access_token: str | None, payload: dict) -> dict:
        row = await self.repository.create_project(user_id=user_id, access_token=access_token, payload=payload)
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create project")
        return serialize_project(row)

    async def update_project(self, *, user_id: str, access_token: str | None, project_id: str, payload: dict) -> dict:
        normalized_id = normalize_uuid(project_id, field_name="project_id")
        row = await self.repository.update_project(user_id=user_id, access_token=access_token, project_id=normalized_id, payload=payload)
        if row is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return serialize_project(row)

    async def archive_project(self, *, user_id: str, access_token: str | None, project_id: str) -> dict:
        return await self.update_project(
            user_id=user_id,
            access_token=access_token,
            project_id=project_id,
            payload={"status": "archived", "archived_at": datetime.now(timezone.utc).isoformat()},
        )

    async def restore_project(self, *, user_id: str, access_token: str | None, project_id: str) -> dict:
        return await self.update_project(
            user_id=user_id,
            access_token=access_token,
            project_id=project_id,
            payload={"status": "active", "archived_at": None},
        )

    async def delete_project(self, *, user_id: str, access_token: str | None, project_id: str) -> dict:
        normalized_id = normalize_uuid(project_id, field_name="project_id")
        rows = await self.repository.delete_project(user_id=user_id, access_token=access_token, project_id=normalized_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"ok": True, "id": normalized_id}

    async def ensure_project_exists(self, *, user_id: str, access_token: str | None, project_id: str | None) -> str | None:
        if not project_id:
            return None
        normalized_id = normalize_uuid(project_id, field_name="project_id")
        await self.get_project(user_id=user_id, access_token=access_token, project_id=normalized_id)
        return normalized_id

    async def list_tags(self, *, user_id: str, access_token: str | None) -> list[dict]:
        rows = await self.repository.list_tags(user_id=user_id, access_token=access_token)
        return [serialize_tag(row) for row in rows]

    async def create_tag(self, *, user_id: str, access_token: str | None, name: str) -> dict:
        existing = await self.repository.get_tag_by_name(user_id=user_id, access_token=access_token, name=name)
        if existing is not None:
            return serialize_tag(existing)
        row = await self.repository.create_tag(user_id=user_id, access_token=access_token, name=name)
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create tag")
        return serialize_tag(row)

    async def update_tag(self, *, user_id: str, access_token: str | None, tag_id: str, name: str) -> dict:
        normalized_id = normalize_uuid(tag_id, field_name="tag_id")
        row = await self.repository.update_tag(user_id=user_id, access_token=access_token, tag_id=normalized_id, name=name)
        if row is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        return serialize_tag(row)

    async def delete_tag(self, *, user_id: str, access_token: str | None, tag_id: str) -> dict:
        normalized_id = normalize_uuid(tag_id, field_name="tag_id")
        rows = await self.repository.delete_tag(user_id=user_id, access_token=access_token, tag_id=normalized_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Tag not found")
        return {"ok": True, "id": normalized_id}

    async def resolve_tags(
        self,
        *,
        user_id: str,
        access_token: str | None,
        tag_ids: list[str] | None = None,
        names: list[str] | None = None,
    ) -> list[dict]:
        normalized_ids = normalize_uuid_list(tag_ids or [], field_name="tag_id") if tag_ids else []
        rows = await self.repository.get_tags_by_ids(user_id=user_id, access_token=access_token, tag_ids=normalized_ids)
        by_id = {row["id"]: row for row in rows if row.get("id")}
        resolved_rows = [by_id[tag_id] for tag_id in normalized_ids if tag_id in by_id]
        if len(resolved_rows) != len(normalized_ids):
            raise HTTPException(status_code=403, detail="Invalid tag references.")

        seen_names = {str(row.get("name") or "").strip().lower() for row in resolved_rows}
        for raw_name in names or []:
            clean_name = (raw_name or "").strip()
            if not clean_name or clean_name.lower() in seen_names:
                continue
            tag = await self.create_tag(user_id=user_id, access_token=access_token, name=clean_name)
            resolved_rows.append({"id": tag["id"], "name": tag["name"]})
            seen_names.add(clean_name.lower())
        return [serialize_tag(row if isinstance(row, dict) else {}) for row in resolved_rows]

    async def resolve_tag_ids(
        self,
        *,
        user_id: str,
        access_token: str | None,
        tag_ids: list[str] | None = None,
        names: list[str] | None = None,
    ) -> list[str]:
        tags = await self.resolve_tags(user_id=user_id, access_token=access_token, tag_ids=tag_ids, names=names)
        return [tag["id"] for tag in tags if tag.get("id")]
