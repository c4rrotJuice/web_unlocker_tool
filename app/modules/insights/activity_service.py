from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.core.serialization import serialize_milestone, serialize_ok_envelope
from app.modules.insights.aggregation_service import ActivityAggregationService
from app.modules.insights.milestone_service import MilestoneService
from app.modules.insights.repo import InsightsRepository
from app.modules.insights.streak_service import StreakService


SUPPORTED_ACTIVITY_EVENT_TYPES = frozenset(
    {
        "unlock",
        "source_captured",
        "citation_created",
        "quote_saved",
        "note_created",
        "document_updated",
    }
)


class ActivityService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository
        self.aggregation_service = ActivityAggregationService(repository=repository)
        self.streak_service = StreakService(repository=repository)
        self.milestone_service = MilestoneService(repository=repository)

    def _validate_type(self, type: str) -> str:
        normalized = str(type or "").strip()
        if normalized not in SUPPORTED_ACTIVITY_EVENT_TYPES:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "activity_event_type_invalid",
                    "message": "Unsupported activity event type.",
                },
            )
        return normalized

    async def log_event(self, user_id: str, type: str, entity_id: str | None = None) -> dict[str, Any]:
        event_type = self._validate_type(type)
        _deduped, row = await self.repository.insert_activity_event(
            payload={
                "user_id": user_id,
                "type": event_type,
                "entity_id": entity_id,
            }
        )
        if row is None:
            raise HTTPException(status_code=503, detail="Failed to record activity event.")
        if not _deduped:
            aggregation = await self.aggregation_service.update_daily_activity(user_id, row)
            if aggregation["became_active_day"]:
                await self.streak_service.update_streak(user_id, aggregation["activity_date"])
            await self.milestone_service.evaluate_milestones(user_id)
        return row

    async def activity_summary(self, *, user_id: str, days: int = 7) -> dict[str, object]:
        clamped_days = min(max(int(days or 7), 7), 30)
        today = datetime.now(timezone.utc).date()
        start_date = (today - timedelta(days=clamped_days - 1)).isoformat()
        end_date = (today + timedelta(days=1)).isoformat()
        rows = await self.repository.list_daily_activity(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=clamped_days,
        )
        items = []
        for row in rows:
            score = int(row.get("activity_score") or 0)
            items.append(
                {
                    "date": row.get("date"),
                    "activity_score": score,
                    "actions_count": int(row.get("actions_count") or 0),
                    "active_day": score >= 3,
                    "last_event_at": row.get("last_event_at"),
                }
            )
        return serialize_ok_envelope(items, meta={"days": clamped_days})

    async def streak_summary(self, *, user_id: str) -> dict[str, object]:
        state = await self.repository.get_activity_state(user_id=user_id) or {}
        return serialize_ok_envelope(
            {
                "current_streak": int(state.get("current_streak") or 0),
                "longest_streak": int(state.get("longest_streak") or 0),
                "last_active_date": state.get("last_active_date"),
                "updated_at": state.get("updated_at"),
            }
        )

    async def milestones_summary(self, *, user_id: str) -> dict[str, object]:
        rows = await self.repository.list_milestones(user_id=user_id)
        progress = await self.milestone_service.progress(user_id=user_id)
        earned = [
            serialize_milestone(
                row,
                label=str((row.get("metadata") or {}).get("label") or row.get("milestone_key")),
            )
            for row in rows
        ]
        return serialize_ok_envelope({"earned": earned, "progress": progress})
