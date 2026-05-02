from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.modules.insights.repo import InsightsRepository


EVENT_SCORES: dict[str, int] = {
    "unlock": 1,
    "citation_created": 2,
    "quote_saved": 2,
    "note_created": 3,
    "document_updated": 4,
}

ACTIVE_DAY_THRESHOLD = 3


class ActivityAggregationService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository

    def _created_at(self, event: dict[str, Any]) -> datetime:
        raw_created_at = event.get("created_at")
        if isinstance(raw_created_at, datetime):
            created_at = raw_created_at
        elif isinstance(raw_created_at, str):
            created_at = datetime.fromisoformat(raw_created_at.replace("Z", "+00:00"))
        else:
            created_at = datetime.now(timezone.utc)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return created_at.astimezone(timezone.utc)

    async def update_daily_activity(self, user_id: str, event: dict[str, Any]) -> dict[str, object]:
        created_at = self._created_at(event)
        event_type = str(event.get("type") or "")
        activity_date = created_at.date().isoformat()
        existing = await self.repository.get_daily_activity(user_id=user_id, activity_date=activity_date)
        previous_score = int((existing or {}).get("activity_score") or 0)
        previous_count = int((existing or {}).get("actions_count") or 0)
        score_delta = int(EVENT_SCORES.get(event_type, 0))
        next_score = previous_score + score_delta
        next_count = previous_count + 1
        was_active_day = previous_score >= ACTIVE_DAY_THRESHOLD
        active_day = next_score >= ACTIVE_DAY_THRESHOLD
        row = await self.repository.upsert_daily_activity(
            user_id=user_id,
            activity_date=activity_date,
            activity_score=next_score,
            actions_count=next_count,
            last_event_at=created_at.astimezone(timezone.utc).isoformat(),
        )
        return {
            "row": row,
            "activity_date": activity_date,
            "active_day": active_day,
            "became_active_day": active_day and not was_active_day,
        }
