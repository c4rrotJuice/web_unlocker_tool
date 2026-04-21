from __future__ import annotations

from datetime import datetime, timezone

from app.modules.insights.repo import InsightsRepository


EVENT_SCORES: dict[str, int] = {
    "unlock": 1,
    "source_captured": 1,
    "citation_created": 2,
    "quote_saved": 2,
    "note_created": 3,
    "document_updated": 4,
}

ACTIVE_DAY_THRESHOLD = 3


class ActivityAggregationService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository

    async def aggregate_event(self, *, user_id: str, event_type: str, created_at: datetime) -> dict[str, object]:
        activity_date = created_at.date().isoformat()
        existing = await self.repository.get_daily_activity(user_id=user_id, activity_date=activity_date)
        previous_score = int((existing or {}).get("activity_score") or 0)
        previous_count = int((existing or {}).get("actions_count") or 0)
        score_delta = int(EVENT_SCORES.get(event_type, 0))
        next_score = previous_score + score_delta
        next_count = previous_count + 1
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
            "was_active_day": previous_score >= ACTIVE_DAY_THRESHOLD,
            "is_active_day": next_score >= ACTIVE_DAY_THRESHOLD,
        }
