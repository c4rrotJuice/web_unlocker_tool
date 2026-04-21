from __future__ import annotations

import base64
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.core.entitlements import require_capability
from app.core.errors import CapabilityForbiddenError
from app.core.serialization import (
    serialize_activity_event,
    serialize_bookmark,
    serialize_milestone,
    serialize_module_status,
    serialize_ok_envelope,
    serialize_paging_meta,
)
from app.modules.unlock.repo import UnlockRepository
from app.services.momentum import MILESTONE_CONFIG, calculate_streak, count_active_days_in_range, determine_new_milestones


class UnlockService:
    def __init__(self, *, repository: UnlockRepository, contract: str, activity_service=None):
        self.repository = repository
        self.contract = contract
        self.activity_service = activity_service

    def status(self) -> dict[str, object]:
        return serialize_module_status(
            module="unlock",
            contract=self.contract,
            notes=[
                "Activity history, bookmarks, guest usage, and milestone persistence are canonical.",
                "Milestone reconciliation runs on activity writes, not reporting reads.",
            ],
        )

    def _milestone_title_map(self) -> dict[str, str]:
        return {milestone.key: milestone.title for milestone in MILESTONE_CONFIG}

    def _decode_cursor(self, cursor: str | None) -> tuple[str | None, str | None]:
        if not cursor:
            return None, None
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
            created_at, row_id = decoded.split("|", 1)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid cursor.") from exc
        return created_at, row_id

    def _encode_cursor(self, created_at: str | None, row_id: str | None) -> str | None:
        if not created_at or not row_id:
            return None
        raw = f"{created_at}|{row_id}".encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii")

    def _normalize_domain(self, *, url: str | None, domain: str | None) -> str:
        if domain:
            normalized = domain.strip().lower()
            if normalized:
                return normalized
        if url:
            parsed = urlsplit(url.strip())
            host = parsed.netloc.strip().lower()
            if host:
                return host
        raise HTTPException(status_code=422, detail="A valid url or domain is required.")

    def _normalize_activity_payload(self, *, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()
        url = payload.get("url")
        url = url.strip() if isinstance(url, str) and url.strip() else None
        domain = self._normalize_domain(url=url, domain=payload.get("domain"))
        return {
            "user_id": user_id,
            "url": url or f"https://{domain}",
            "domain": domain,
            "source": payload.get("source") or "web",
            "event_type": payload["event_type"],
            "event_id": payload.get("event_id"),
            "was_cleaned": bool(payload.get("was_cleaned", True)),
            "created_at": now_iso,
        }

    async def reconcile_milestones(self, *, user_id: str, reference_date: date | None = None) -> list[dict[str, object]]:
        today = reference_date or datetime.now(timezone.utc).date()
        month_start = today.replace(day=1)
        next_month_start = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
        unlock_days = await self.repository.get_unlock_days(
            user_id=user_id,
            start_date=month_start - timedelta(days=31),
            end_date=today,
        )
        current_streak_days, _has_today = calculate_streak(unlock_days, today)
        active_days_mtd = count_active_days_in_range(unlock_days, month_start, next_month_start)
        unlocks_all_time = await self.repository.count_unlock_events(user_id=user_id, event_type="unlock")
        existing = await self.repository.list_milestones(user_id=user_id)
        existing_keys = {str(item.get("milestone_key")) for item in existing if item.get("milestone_key")}
        to_award = determine_new_milestones(
            {
                "current_streak_days": current_streak_days,
                "articles_unlocked_all_time": unlocks_all_time,
                "active_days_mtd": active_days_mtd,
            },
            existing_keys,
        )

        awarded: list[dict[str, object]] = []
        label_map = self._milestone_title_map()
        for milestone in to_award:
            inserted, row = await self.repository.insert_milestone(
                user_id=user_id,
                milestone_key=milestone["key"],
                metadata={"threshold": milestone["threshold"]},
            )
            if inserted and row is not None:
                awarded.append(serialize_milestone(row, label=label_map.get(milestone["key"], milestone["key"])))
        return awarded

    async def record_activity_event(self, *, user_id: str, payload: dict[str, Any], reconcile_milestones: bool = True) -> dict[str, object]:
        normalized = self._normalize_activity_payload(user_id=user_id, payload=payload)
        deduped, row = await self.repository.insert_activity_event(payload=normalized)
        if row is None:
            raise HTTPException(status_code=503, detail="Failed to record activity event.")
        awarded: list[dict[str, object]] = []
        if reconcile_milestones and not deduped and normalized["event_type"] == "unlock":
            awarded = await self.reconcile_milestones(user_id=user_id)
        if self.activity_service is not None and not deduped:
            mapped_type = "unlock"
            if normalized["event_type"] == "selection_capture":
                mapped_type = "source_captured"
            try:
                await self.activity_service.record_event(
                    user_id=user_id,
                    event_type=mapped_type,
                    idempotency_key=str(normalized.get("event_id") or row.get("id") or ""),
                )
            except HTTPException:
                pass
        return serialize_ok_envelope(
            {
                "deduped": deduped,
                "event": serialize_activity_event(row),
                "milestones_awarded": awarded,
            }
        )

    async def list_activity_history(
        self,
        *,
        user_id: str,
        event_type: str | None,
        domain: str | None,
        limit: int,
        cursor: str | None,
        direction: str,
    ) -> dict[str, object]:
        cursor_created_at, cursor_id = self._decode_cursor(cursor)
        rows = await self.repository.list_activity_events(
            user_id=user_id,
            limit=limit + 1,
            direction=direction,
            event_type=event_type,
            domain=(domain or "").strip().lower() or None,
            cursor_created_at=cursor_created_at,
            cursor_id=cursor_id,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = None
        if has_more and page_rows:
            next_cursor = self._encode_cursor(page_rows[-1].get("created_at"), page_rows[-1].get("id"))
        return serialize_ok_envelope(
            [serialize_activity_event(row) for row in page_rows],
            meta=serialize_paging_meta(next_cursor=next_cursor, has_more=has_more),
        )

    async def list_bookmarks(self, *, user_id: str, limit: int, cursor: str | None, direction: str) -> dict[str, object]:
        cursor_created_at, cursor_id = self._decode_cursor(cursor)
        rows = await self.repository.list_bookmarks(
            user_id=user_id,
            limit=limit + 1,
            direction=direction,
            cursor_created_at=cursor_created_at,
            cursor_id=cursor_id,
        )
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        next_cursor = None
        if has_more and page_rows:
            next_cursor = self._encode_cursor(page_rows[-1].get("created_at"), page_rows[-1].get("id"))
        return serialize_ok_envelope(
            [serialize_bookmark(row) for row in page_rows],
            meta=serialize_paging_meta(next_cursor=next_cursor, has_more=has_more),
        )

    async def create_bookmark(self, *, user_id: str, capability_state, payload: dict[str, Any]) -> dict[str, object]:
        try:
            require_capability("bookmarks", capability_state)
        except CapabilityForbiddenError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        domain = self._normalize_domain(url=payload.get("url"), domain=payload.get("domain"))
        created, row = await self.repository.insert_bookmark(
            payload={
                "user_id": user_id,
                "url": payload["url"].strip(),
                "domain": domain,
                "title": payload.get("title"),
                "saved_from": payload.get("saved_from") or "web",
            }
        )
        if row is None:
            raise HTTPException(status_code=503, detail="Failed to create bookmark.")
        return serialize_ok_envelope(
            serialize_bookmark(row),
            meta={"created": created},
        )

    async def delete_bookmark(self, *, user_id: str, bookmark_id: str) -> dict[str, object]:
        deleted = await self.repository.delete_bookmark(user_id=user_id, bookmark_id=bookmark_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Bookmark not found.")
        return serialize_ok_envelope({"id": bookmark_id})

    async def list_milestones(self, *, user_id: str) -> dict[str, object]:
        label_map = self._milestone_title_map()
        rows = await self.repository.list_milestones(user_id=user_id)
        return serialize_ok_envelope(
            [
                serialize_milestone(row, label=label_map.get(str(row.get("milestone_key")), str(row.get("milestone_key"))))
                for row in rows
            ]
        )

    async def touch_guest_usage(self, *, usage_key: str, usage_date: date) -> dict[str, object]:
        row = await self.repository.upsert_guest_usage(usage_key=usage_key, usage_date=usage_date)
        return serialize_ok_envelope(row or {})
