from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.modules.insights.activity_service import ActivityService
from app.modules.insights.aggregation_service import ACTIVE_DAY_THRESHOLD, ActivityAggregationService, EVENT_SCORES
from app.modules.insights.milestone_service import RULES, MilestoneService
from app.modules.insights.streak_service import StreakService


class FakeActivityRepository:
    def __init__(self):
        self.payloads: list[dict[str, object]] = []
        self.next_deduped = False
        self.next_row: dict[str, object] | None = None
        self.daily: dict[tuple[str, str], dict[str, object]] = {}
        self.upserts: list[dict[str, object]] = []
        self.activity_state: dict[str, dict[str, object]] = {}
        self.state_upserts: list[dict[str, object]] = []
        self.milestones: list[dict[str, object]] = []
        self.documents_count = 0
        self.document_citations_count = 0

    async def insert_activity_event(self, *, payload: dict[str, object]):
        self.payloads.append(payload)
        row = self.next_row or {
            "id": f"event-{len(self.payloads)}",
            **payload,
            "created_at": "2026-05-02T10:00:00+00:00",
        }
        return self.next_deduped, row

    async def get_daily_activity(self, *, user_id: str, activity_date: str):
        return self.daily.get((user_id, activity_date))

    async def upsert_daily_activity(
        self,
        *,
        user_id: str,
        activity_date: str,
        activity_score: int,
        actions_count: int,
        last_event_at: str,
    ):
        row = {
            "user_id": user_id,
            "date": activity_date,
            "activity_score": activity_score,
            "actions_count": actions_count,
            "last_event_at": last_event_at,
        }
        self.daily[(user_id, activity_date)] = row
        self.upserts.append(row)
        return row

    async def get_activity_state(self, *, user_id: str):
        return self.activity_state.get(user_id)

    async def upsert_activity_state(
        self,
        *,
        user_id: str,
        current_streak: int,
        longest_streak: int,
        last_active_date: str | None,
        updated_at: str,
    ):
        row = {
            "user_id": user_id,
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_active_date": last_active_date,
            "updated_at": updated_at,
        }
        self.activity_state[user_id] = row
        self.state_upserts.append(row)
        return row

    async def list_milestones(self, *, user_id: str, month_start: str | None = None, month_end: str | None = None):
        return [row for row in self.milestones if row["user_id"] == user_id]

    async def insert_milestone(self, *, user_id: str, milestone_key: str, metadata: dict[str, object]):
        for row in self.milestones:
            if row["user_id"] == user_id and row["milestone_key"] == milestone_key:
                return False, row
        row = {
            "id": f"milestone-{len(self.milestones) + 1}",
            "user_id": user_id,
            "milestone_key": milestone_key,
            "metadata": metadata,
            "awarded_at": "2026-05-02T10:00:00+00:00",
        }
        self.milestones.append(row)
        return True, row

    async def count_activity_events(self, *, user_id: str, event_type: str):
        return sum(1 for row in self.payloads if row["user_id"] == user_id and row["type"] == event_type)

    async def count_documents_for_user(self, *, user_id: str):
        return self.documents_count

    async def count_document_citations_for_user(self, *, user_id: str):
        return self.document_citations_count

    async def list_daily_activity(self, *, user_id: str, start_date: str, end_date: str, limit: int = 90):
        rows = [
            row
            for (row_user_id, activity_date), row in self.daily.items()
            if row_user_id == user_id and start_date <= activity_date < end_date
        ]
        return sorted(rows, key=lambda row: str(row["date"]), reverse=True)[:limit]


@pytest.mark.anyio
async def test_log_event_inserts_supported_activity_event():
    repo = FakeActivityRepository()
    service = ActivityService(repository=repo)

    row = await service.log_event(
        "11111111-1111-1111-1111-111111111111",
        "quote_saved",
        entity_id="22222222-2222-2222-2222-222222222222",
    )

    assert row["type"] == "quote_saved"
    assert repo.payloads == [
        {
            "user_id": "11111111-1111-1111-1111-111111111111",
            "type": "quote_saved",
            "entity_id": "22222222-2222-2222-2222-222222222222",
        }
    ]
    assert repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-02")]["activity_score"] == 2
    assert repo.state_upserts == []


@pytest.mark.anyio
async def test_log_event_rejects_invalid_type():
    service = ActivityService(repository=FakeActivityRepository())

    with pytest.raises(HTTPException) as exc:
        await service.log_event("11111111-1111-1111-1111-111111111111", "streak_incremented")

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "activity_event_type_invalid"


@pytest.mark.anyio
async def test_log_event_is_safe_when_repository_reports_deduped_row():
    repo = FakeActivityRepository()
    repo.next_deduped = True
    repo.next_row = {
        "id": "existing-event",
        "user_id": "11111111-1111-1111-1111-111111111111",
        "type": "unlock",
        "entity_id": None,
        "created_at": "2026-05-02T10:00:00+00:00",
    }
    service = ActivityService(repository=repo)

    row = await service.log_event("11111111-1111-1111-1111-111111111111", "unlock")

    assert row["id"] == "existing-event"
    assert len(repo.payloads) == 1
    assert repo.upserts == []


@pytest.mark.anyio
async def test_log_event_uses_server_timestamp_only():
    repo = FakeActivityRepository()
    service = ActivityService(repository=repo)

    await service.log_event("11111111-1111-1111-1111-111111111111", "note_created")

    assert "created_at" not in repo.payloads[0]


def test_activity_events_schema_is_phase1_event_log_only():
    migration = Path("writior_migration_pack/003_growth_and_unlocks.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.activity_events" in migration
    assert "type text not null" in migration
    assert "created_at timestamptz not null default now()" in migration
    assert "on public.activity_events(user_id, created_at desc)" in migration
    assert "idempotency_key" not in migration
    assert "event_type text not null check (event_type in ('unlock', 'source_captured'" not in migration


def test_user_daily_activity_schema_is_daily_rollup_only():
    migration = Path("writior_migration_pack/003_growth_and_unlocks.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.user_daily_activity" in migration
    assert "user_id uuid not null references auth.users(id) on delete cascade" in migration
    assert "date date not null" in migration
    assert "activity_score integer not null default 0" in migration
    assert "actions_count integer not null default 0" in migration
    assert "last_event_at timestamptz not null default now()" in migration
    assert "primary key (user_id, date)" in migration


def test_user_activity_state_schema_is_canonical_streak_state():
    migration = Path("writior_migration_pack/003_growth_and_unlocks.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.user_activity_state" in migration
    assert "user_id uuid primary key references auth.users(id) on delete cascade" in migration
    assert "current_streak integer not null default 0" in migration
    assert "longest_streak integer not null default 0" in migration
    assert "last_active_date date" in migration
    assert "updated_at timestamptz not null default now()" in migration


@pytest.mark.anyio
async def test_daily_aggregation_scores_single_event_correctly():
    repo = FakeActivityRepository()
    aggregation = ActivityAggregationService(repository=repo)

    result = await aggregation.update_daily_activity(
        "11111111-1111-1111-1111-111111111111",
        {
            "type": "note_created",
            "created_at": "2026-05-02T21:45:00+03:00",
        },
    )

    row = repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-02")]
    assert row["activity_score"] == 3
    assert row["actions_count"] == 1
    assert row["last_event_at"] == "2026-05-02T18:45:00+00:00"
    assert result["active_day"] is True


@pytest.mark.anyio
async def test_daily_aggregation_updates_existing_same_day_row():
    repo = FakeActivityRepository()
    aggregation = ActivityAggregationService(repository=repo)

    await aggregation.update_daily_activity(
        "11111111-1111-1111-1111-111111111111",
        {"type": "unlock", "created_at": "2026-05-02T10:00:00+00:00"},
    )
    await aggregation.update_daily_activity(
        "11111111-1111-1111-1111-111111111111",
        {"type": "quote_saved", "created_at": "2026-05-02T11:00:00+00:00"},
    )

    assert len(repo.daily) == 1
    row = repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-02")]
    assert row["activity_score"] == 3
    assert row["actions_count"] == 2
    assert row["last_event_at"] == "2026-05-02T11:00:00+00:00"


@pytest.mark.anyio
async def test_daily_aggregation_keeps_different_days_separate():
    repo = FakeActivityRepository()
    aggregation = ActivityAggregationService(repository=repo)

    await aggregation.update_daily_activity(
        "11111111-1111-1111-1111-111111111111",
        {"type": "citation_created", "created_at": "2026-05-02T23:59:00+00:00"},
    )
    await aggregation.update_daily_activity(
        "11111111-1111-1111-1111-111111111111",
        {"type": "document_updated", "created_at": "2026-05-03T00:01:00+00:00"},
    )

    assert sorted(date for _, date in repo.daily) == ["2026-05-02", "2026-05-03"]
    assert repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-02")]["activity_score"] == 2
    assert repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-03")]["activity_score"] == 4


def test_scoring_rules_match_phase2_contract():
    assert EVENT_SCORES == {
        "unlock": 1,
        "citation_created": 2,
        "quote_saved": 2,
        "note_created": 3,
        "document_updated": 4,
    }
    assert ACTIVE_DAY_THRESHOLD == 3


@pytest.mark.anyio
async def test_streak_increments_for_consecutive_active_days():
    repo = FakeActivityRepository()
    service = StreakService(repository=repo)

    first = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 1))
    second = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 2))

    assert first["current_streak"] == 1
    assert second["current_streak"] == 2
    assert second["longest_streak"] == 2
    assert second["last_active_date"] == "2026-05-02"


@pytest.mark.anyio
async def test_streak_resets_after_missed_day():
    repo = FakeActivityRepository()
    service = StreakService(repository=repo)

    await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 1))
    reset = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 3))

    assert reset["current_streak"] == 1
    assert reset["longest_streak"] == 1
    assert reset["last_active_date"] == "2026-05-03"


@pytest.mark.anyio
async def test_streak_ignores_duplicate_same_day_update():
    repo = FakeActivityRepository()
    service = StreakService(repository=repo)

    first = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 1))
    duplicate = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 1))

    assert first["updated"] is True
    assert duplicate["updated"] is False
    assert duplicate["current_streak"] == 1
    assert len(repo.state_upserts) == 1


@pytest.mark.anyio
async def test_streak_tracks_longest_across_reset():
    repo = FakeActivityRepository()
    service = StreakService(repository=repo)

    await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 1))
    await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 2))
    reset = await service.update_streak("11111111-1111-1111-1111-111111111111", date(2026, 5, 4))

    assert reset["current_streak"] == 1
    assert reset["longest_streak"] == 2


@pytest.mark.anyio
async def test_activity_service_updates_streak_only_when_day_becomes_active():
    repo = FakeActivityRepository()
    service = ActivityService(repository=repo)

    await service.log_event("11111111-1111-1111-1111-111111111111", "unlock")
    await service.log_event("11111111-1111-1111-1111-111111111111", "quote_saved")
    await service.log_event("11111111-1111-1111-1111-111111111111", "note_created")

    row = repo.daily[("11111111-1111-1111-1111-111111111111", "2026-05-02")]
    assert row["activity_score"] == 6
    assert row["actions_count"] == 3
    assert len(repo.state_upserts) == 1
    assert repo.state_upserts[0]["current_streak"] == 1
    assert repo.state_upserts[0]["last_active_date"] == "2026-05-02"


def test_milestone_rules_match_phase4_contract():
    rules = {rule.id: rule for rule in RULES}

    assert rules["streak_3"].type == "streak"
    assert rules["streak_3"].threshold == 3
    assert rules["streak_7"].threshold == 7
    assert rules["streak_30"].threshold == 30
    assert rules["sources_10"].type == "count"
    assert rules["sources_10"].threshold == 10
    assert rules["notes_25"].threshold == 25
    assert rules["citations_50"].threshold == 50
    assert rules["workflow_first_document"].type == "workflow"
    assert rules["workflow_first_document"].metric == "documents_total"
    assert rules["workflow_first_note"].metric == "note_created"
    assert rules["workflow_first_citation_attached"].metric == "document_citations_total"


@pytest.mark.anyio
async def test_milestone_service_awards_triggered_rules_once():
    repo = FakeActivityRepository()
    repo.activity_state["11111111-1111-1111-1111-111111111111"] = {
        "user_id": "11111111-1111-1111-1111-111111111111",
        "current_streak": 3,
        "longest_streak": 3,
        "last_active_date": "2026-05-03",
    }
    service = MilestoneService(repository=repo)

    first = await service.evaluate_milestones("11111111-1111-1111-1111-111111111111")
    second = await service.evaluate_milestones("11111111-1111-1111-1111-111111111111")

    assert [row["milestone_key"] for row in first] == ["streak_3"]
    assert second == []
    assert [row["milestone_key"] for row in repo.milestones] == ["streak_3"]


@pytest.mark.anyio
async def test_milestone_service_awards_count_and_workflow_rules():
    repo = FakeActivityRepository()
    user_id = "11111111-1111-1111-1111-111111111111"
    for index in range(10):
        repo.payloads.append({"user_id": user_id, "type": "source_captured", "entity_id": f"source-{index}"})
    for index in range(25):
        repo.payloads.append({"user_id": user_id, "type": "note_created", "entity_id": f"note-{index}"})
    for index in range(50):
        repo.payloads.append({"user_id": user_id, "type": "citation_created", "entity_id": f"citation-{index}"})
    repo.documents_count = 1
    repo.document_citations_count = 1
    service = MilestoneService(repository=repo)

    awarded = await service.evaluate_milestones(user_id)

    awarded_keys = {row["milestone_key"] for row in awarded}
    assert "sources_10" in awarded_keys
    assert "notes_25" in awarded_keys
    assert "citations_50" in awarded_keys
    assert "workflow_first_document" in awarded_keys
    assert "workflow_first_note" in awarded_keys
    assert "workflow_first_citation_attached" in awarded_keys


@pytest.mark.anyio
async def test_activity_service_triggers_milestones_after_aggregation_and_streak():
    repo = FakeActivityRepository()
    service = ActivityService(repository=repo)

    await service.log_event("11111111-1111-1111-1111-111111111111", "note_created")

    awarded_keys = {row["milestone_key"] for row in repo.milestones}
    assert "workflow_first_note" in awarded_keys
    assert repo.state_upserts[0]["current_streak"] == 1


@pytest.mark.anyio
async def test_activity_summary_reads_precomputed_daily_rows_with_active_flag():
    repo = FakeActivityRepository()
    user_id = "11111111-1111-1111-1111-111111111111"
    repo.daily[(user_id, "2026-05-02")] = {
        "user_id": user_id,
        "date": "2026-05-02",
        "activity_score": 3,
        "actions_count": 2,
        "last_event_at": "2026-05-02T10:00:00+00:00",
    }
    repo.daily[(user_id, "2026-05-01")] = {
        "user_id": user_id,
        "date": "2026-05-01",
        "activity_score": 1,
        "actions_count": 1,
        "last_event_at": "2026-05-01T10:00:00+00:00",
    }
    service = ActivityService(repository=repo)

    response = await service.activity_summary(user_id=user_id, days=999)

    assert response["meta"]["days"] == 30
    assert response["data"][0]["activity_score"] == 3
    assert response["data"][0]["active_day"] is True
    assert response["data"][1]["active_day"] is False


@pytest.mark.anyio
async def test_streak_summary_reads_precomputed_state():
    repo = FakeActivityRepository()
    user_id = "11111111-1111-1111-1111-111111111111"
    repo.activity_state[user_id] = {
        "user_id": user_id,
        "current_streak": 7,
        "longest_streak": 12,
        "last_active_date": "2026-05-02",
        "updated_at": "2026-05-02T10:00:00+00:00",
    }
    service = ActivityService(repository=repo)

    response = await service.streak_summary(user_id=user_id)

    assert response["data"]["current_streak"] == 7
    assert response["data"]["longest_streak"] == 12
    assert response["data"]["last_active_date"] == "2026-05-02"


@pytest.mark.anyio
async def test_milestones_summary_returns_earned_and_progress():
    repo = FakeActivityRepository()
    user_id = "11111111-1111-1111-1111-111111111111"
    await repo.insert_milestone(
        user_id=user_id,
        milestone_key="streak_3",
        metadata={"label": "3-day streak", "threshold": 3},
    )
    repo.activity_state[user_id] = {"current_streak": 2}
    service = ActivityService(repository=repo)

    response = await service.milestones_summary(user_id=user_id)

    assert response["data"]["earned"][0]["key"] == "streak_3"
    assert response["data"]["progress"]
    assert response["data"]["progress"][0].keys() >= {"id", "type", "metric", "threshold", "value", "earned"}


def test_core_action_writes_use_canonical_activity_service():
    service_paths = [
        "app/modules/unlock/service.py",
        "app/modules/research/sources/service.py",
        "app/modules/research/citations/service.py",
        "app/modules/research/quotes/service.py",
        "app/modules/research/notes/service.py",
        "app/modules/workspace/service.py",
    ]

    combined = "\n".join(Path(path).read_text(encoding="utf-8") for path in service_paths)

    assert "activity_service.log_event" in combined
    assert "activity_service.record_event" not in combined
    assert "idempotency_key=" not in combined
    for event_type in [
        "unlock",
        "source_captured",
        "citation_created",
        "quote_saved",
        "note_created",
        "document_updated",
    ]:
        assert event_type in combined
