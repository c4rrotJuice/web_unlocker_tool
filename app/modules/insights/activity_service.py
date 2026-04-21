from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.modules.insights.aggregation_service import ActivityAggregationService
from app.modules.insights.milestone_service import MilestoneService
from app.modules.insights.repo import InsightsRepository
from app.modules.insights.streak_service import StreakService


class ActivityService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository
        self.aggregation_service = ActivityAggregationService(repository=repository)
        self.streak_service = StreakService(repository=repository)
        self.milestone_service = MilestoneService(repository=repository)

    def _timezone(self, timezone_name: str | None) -> ZoneInfo:
        if not timezone_name:
            return ZoneInfo("UTC")
        try:
            return ZoneInfo(timezone_name)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid timezone.") from exc

    def _idempotency_key(self, *, user_id: str, event_type: str, entity_id: str | None, explicit_key: str | None) -> str:
        seed = explicit_key or f"{user_id}:{event_type}:{entity_id or ''}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()

    async def record_event(
        self,
        *,
        user_id: str,
        event_type: str,
        entity_id: str | None = None,
        idempotency_key: str | None = None,
        timezone_name: str | None = None,
    ) -> dict[str, object]:
        now = datetime.now(timezone.utc)
        deduped, row = await self.repository.insert_activity_event(
            payload={
                "user_id": user_id,
                "event_type": event_type,
                "entity_id": entity_id,
                "created_at": now.isoformat(),
                "idempotency_key": self._idempotency_key(
                    user_id=user_id,
                    event_type=event_type,
                    entity_id=entity_id,
                    explicit_key=idempotency_key,
                ),
            }
        )
        if row is None:
            raise HTTPException(status_code=503, detail="Failed to record activity event.")

        streak_payload = await self.repository.get_activity_state(user_id=user_id) or {
            "current_streak": 0,
            "longest_streak": 0,
            "last_active_date": None,
        }
        awarded: list[dict[str, object]] = []

        if not deduped:
            aggregation = await self.aggregation_service.aggregate_event(
                user_id=user_id,
                event_type=event_type,
                created_at=now,
            )
            tz = self._timezone(timezone_name)
            local_date = now.astimezone(tz).date()
            if aggregation["is_active_day"] and not aggregation["was_active_day"]:
                streak_payload = await self.streak_service.update_for_active_day(
                    user_id=user_id,
                    active_date=local_date,
                )
            awarded = await self.milestone_service.evaluate(user_id=user_id, streak=streak_payload)

        return {
            "deduped": deduped,
            "event": row,
            "streak": streak_payload,
            "milestones_awarded": awarded,
        }

    async def activity_summary(self, *, user_id: str, days: int = 30) -> dict[str, object]:
        today = datetime.now(timezone.utc).date()
        start_date = (today - timedelta(days=max(days - 1, 0))).isoformat()
        end_date = (today + timedelta(days=1)).isoformat()
        rows = await self.repository.list_daily_activity(user_id=user_id, start_date=start_date, end_date=end_date, limit=days)
        active_days = sum(1 for row in rows if int(row.get("activity_score") or 0) >= 3)
        return serialize_ok_envelope(
            {
                "active_days": active_days,
                "days": rows,
            }
        )

    async def streak_summary(self, *, user_id: str) -> dict[str, object]:
        state = await self.repository.get_activity_state(user_id=user_id) or {}
        return serialize_ok_envelope(
            {
                "current_streak": int(state.get("current_streak") or 0),
                "longest_streak": int(state.get("longest_streak") or 0),
                "last_active_date": state.get("last_active_date"),
            }
        )

    async def milestones_summary(self, *, user_id: str) -> dict[str, object]:
        earned = await self.repository.list_milestones(user_id=user_id)
        progress = await self.milestone_service.progress(user_id=user_id)
        return serialize_ok_envelope({"earned": earned, "progress": progress})
