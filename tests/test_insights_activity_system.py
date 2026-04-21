from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.insights.activity_service import ActivityService
from app.modules.insights.aggregation_service import ACTIVE_DAY_THRESHOLD, ActivityAggregationService
from app.modules.insights.milestone_service import MilestoneService
from app.modules.insights.streak_service import StreakService


class FakeInsightsRepository:
    def __init__(self):
        self.activity_events: list[dict[str, object]] = []
        self.daily: dict[tuple[str, str], dict[str, object]] = {}
        self.activity_state: dict[str, dict[str, object]] = {}
        self.milestones: list[dict[str, object]] = []
        self.documents_count: dict[str, int] = {}
        self.document_citations_count: dict[str, int] = {}

    async def insert_activity_event(self, *, payload: dict[str, object]):
        for row in self.activity_events:
            if row["user_id"] == payload["user_id"] and row["idempotency_key"] == payload["idempotency_key"]:
                return True, row
        row = {"id": f"event-{len(self.activity_events) + 1}", **payload}
        self.activity_events.append(row)
        return False, row

    async def get_activity_event_by_idempotency_key(self, *, user_id: str, idempotency_key: str):
        for row in self.activity_events:
            if row["user_id"] == user_id and row["idempotency_key"] == idempotency_key:
                return row
        return None

    async def get_daily_activity(self, *, user_id: str, activity_date: str):
        return self.daily.get((user_id, activity_date))

    async def upsert_daily_activity(self, *, user_id: str, activity_date: str, activity_score: int, actions_count: int, last_event_at: str):
        row = {
            "user_id": user_id,
            "date": activity_date,
            "activity_score": activity_score,
            "actions_count": actions_count,
            "last_event_at": last_event_at,
        }
        self.daily[(user_id, activity_date)] = row
        return row

    async def get_activity_state(self, *, user_id: str):
        return self.activity_state.get(user_id)

    async def upsert_activity_state(self, *, user_id: str, current_streak: int, longest_streak: int, last_active_date: str | None, updated_at: str):
        row = {
            "user_id": user_id,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_active_date": last_active_date,
            "updated_at": updated_at,
        }
        self.activity_state[user_id] = row
        return row

    async def list_daily_activity(self, *, user_id: str, start_date: str, end_date: str, limit: int = 90):
        return [
            row
            for (row_user_id, _), row in self.daily.items()
            if row_user_id == user_id and start_date <= str(row["date"]) < end_date
        ][:limit]

    async def count_activity_events(self, *, user_id: str, event_type: str):
        return sum(1 for row in self.activity_events if row["user_id"] == user_id and row["event_type"] == event_type)

    async def count_documents_for_user(self, *, user_id: str):
        return self.documents_count.get(user_id, 0)

    async def count_document_citations_for_user(self, *, user_id: str):
        return self.document_citations_count.get(user_id, 0)

    async def list_milestones(self, *, user_id: str, month_start: str | None = None, month_end: str | None = None):
        return [row for row in self.milestones if row["user_id"] == user_id]

    async def insert_milestone(self, *, user_id: str, milestone_key: str, metadata: dict[str, object]):
        for row in self.milestones:
            if row["user_id"] == user_id and row["milestone_key"] == milestone_key:
                return False, row
        row = {
            "id": f"m-{len(self.milestones)+1}",
            "user_id": user_id,
            "milestone_key": milestone_key,
            "metadata": metadata,
            "awarded_at": datetime.now(timezone.utc).isoformat(),
        }
        self.milestones.append(row)
        return True, row


@pytest.mark.anyio
async def test_aggregation_correctness():
    repo = FakeInsightsRepository()
    aggregation = ActivityAggregationService(repository=repo)
    now = datetime.now(timezone.utc)

    first = await aggregation.aggregate_event(user_id="u1", event_type="note_created", created_at=now)
    second = await aggregation.aggregate_event(user_id="u1", event_type="unlock", created_at=now)

    assert first["was_active_day"] is False
    assert first["is_active_day"] is True
    assert second["is_active_day"] is True
    assert repo.daily[("u1", now.date().isoformat())]["activity_score"] == 4
    assert repo.daily[("u1", now.date().isoformat())]["actions_count"] == 2


@pytest.mark.anyio
async def test_streak_increment_consecutive_days():
    repo = FakeInsightsRepository()
    service = StreakService(repository=repo)

    day_one = date(2026, 4, 1)
    day_two = day_one + timedelta(days=1)

    first = await service.update_for_active_day(user_id="u1", active_date=day_one)
    second = await service.update_for_active_day(user_id="u1", active_date=day_two)

    assert first["current_streak"] == 1
    assert second["current_streak"] == 2
    assert second["longest_streak"] == 2


@pytest.mark.anyio
async def test_streak_reset_missed_day():
    repo = FakeInsightsRepository()
    service = StreakService(repository=repo)

    await service.update_for_active_day(user_id="u1", active_date=date(2026, 4, 1))
    reset = await service.update_for_active_day(user_id="u1", active_date=date(2026, 4, 3))

    assert reset["current_streak"] == 1
    assert reset["longest_streak"] == 1


@pytest.mark.anyio
async def test_duplicate_same_day_event_handling():
    repo = FakeInsightsRepository()
    service = ActivityService(repository=repo)

    first = await service.record_event(
        user_id="u1",
        event_type="note_created",
        entity_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        idempotency_key="dedupe-key",
    )
    second = await service.record_event(
        user_id="u1",
        event_type="note_created",
        entity_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        idempotency_key="dedupe-key",
    )

    day_row = next(iter(repo.daily.values()))
    assert first["deduped"] is False
    assert second["deduped"] is True
    assert day_row["actions_count"] == 1
    assert day_row["activity_score"] >= ACTIVE_DAY_THRESHOLD


@pytest.mark.anyio
async def test_milestone_awarding_no_duplicates():
    repo = FakeInsightsRepository()
    milestone_service = MilestoneService(repository=repo)
    repo.documents_count["u1"] = 1
    repo.document_citations_count["u1"] = 1
    for index in range(10):
        repo.activity_events.append(
            {
                "id": f"e-{index}",
                "user_id": "u1",
                "event_type": "source_captured",
                "idempotency_key": f"k-{index}",
            }
        )

    first = await milestone_service.evaluate(user_id="u1", streak={"current_streak": 7})
    second = await milestone_service.evaluate(user_id="u1", streak={"current_streak": 7})

    assert len(first) >= 1
    assert second == []
