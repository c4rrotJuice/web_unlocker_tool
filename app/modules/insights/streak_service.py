from __future__ import annotations

from datetime import date as date_cls, datetime, timedelta, timezone

from app.modules.insights.repo import InsightsRepository


class StreakService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository

    def _date(self, value: date_cls | str) -> date_cls:
        return date_cls.fromisoformat(value) if isinstance(value, str) else value

    async def update_streak(self, user_id: str, date: date_cls | str) -> dict[str, object]:
        active_date = self._date(date)
        state = await self.repository.get_activity_state(user_id=user_id)
        current_streak = int((state or {}).get("current_streak") or 0)
        longest_streak = int((state or {}).get("longest_streak") or 0)
        last_active_raw = (state or {}).get("last_active_date")
        last_active_date = date_cls.fromisoformat(last_active_raw) if isinstance(last_active_raw, str) and last_active_raw else None

        if last_active_date == active_date:
            return {
                "current_streak": current_streak,
                "longest_streak": longest_streak,
                "last_active_date": active_date.isoformat(),
                "updated": False,
            }

        if last_active_date == active_date - timedelta(days=1):
            current_streak += 1
        else:
            current_streak = 1
        longest_streak = max(longest_streak, current_streak)

        await self.repository.upsert_activity_state(
            user_id=user_id,
            current_streak=current_streak,
            longest_streak=longest_streak,
            last_active_date=active_date.isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        return {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_active_date": active_date.isoformat(),
            "updated": True,
        }
