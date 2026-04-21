from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.modules.insights.repo import InsightsRepository


@dataclass(frozen=True)
class MilestoneRule:
    id: str
    type: str
    metric: str
    threshold: int
    label: str


RULES: tuple[MilestoneRule, ...] = (
    MilestoneRule(id="streak_3", type="streak", metric="current_streak", threshold=3, label="3-day streak"),
    MilestoneRule(id="streak_7", type="streak", metric="current_streak", threshold=7, label="7-day streak"),
    MilestoneRule(id="streak_30", type="streak", metric="current_streak", threshold=30, label="30-day streak"),
    MilestoneRule(id="sources_10", type="count", metric="source_captured", threshold=10, label="10 sources captured"),
    MilestoneRule(id="notes_25", type="count", metric="note_created", threshold=25, label="25 notes created"),
    MilestoneRule(id="citations_50", type="count", metric="citation_created", threshold=50, label="50 citations"),
    MilestoneRule(id="workflow_first_document", type="workflow", metric="documents_total", threshold=1, label="first document created"),
    MilestoneRule(id="workflow_first_note", type="workflow", metric="note_created", threshold=1, label="first note created"),
    MilestoneRule(id="workflow_first_citation_attached", type="workflow", metric="document_citations_total", threshold=1, label="first citation attached to document"),
)


class MilestoneService:
    def __init__(self, *, repository: InsightsRepository):
        self.repository = repository

    async def _metrics(self, *, user_id: str, streak: dict[str, Any] | None = None) -> dict[str, int]:
        return {
            "current_streak": int((streak or {}).get("current_streak") or 0),
            "source_captured": await self.repository.count_activity_events(user_id=user_id, event_type="source_captured"),
            "note_created": await self.repository.count_activity_events(user_id=user_id, event_type="note_created"),
            "citation_created": await self.repository.count_activity_events(user_id=user_id, event_type="citation_created"),
            "documents_total": await self.repository.count_documents_for_user(user_id=user_id),
            "document_citations_total": await self.repository.count_document_citations_for_user(user_id=user_id),
        }

    async def evaluate(self, *, user_id: str, streak: dict[str, Any] | None = None) -> list[dict[str, object]]:
        existing = await self.repository.list_milestones(user_id=user_id)
        existing_keys = {str(row.get("milestone_key")) for row in existing if row.get("milestone_key")}
        metrics = await self._metrics(user_id=user_id, streak=streak)

        awarded: list[dict[str, object]] = []
        for rule in RULES:
            if rule.id in existing_keys:
                continue
            if metrics.get(rule.metric, 0) < rule.threshold:
                continue
            inserted, row = await self.repository.insert_milestone(
                user_id=user_id,
                milestone_key=rule.id,
                metadata={
                    "rule_type": rule.type,
                    "metric": rule.metric,
                    "threshold": rule.threshold,
                    "label": rule.label,
                },
            )
            if inserted and row is not None:
                awarded.append(row)
        return awarded

    async def progress(self, *, user_id: str) -> list[dict[str, object]]:
        existing = await self.repository.list_milestones(user_id=user_id)
        earned_keys = {str(row.get("milestone_key")) for row in existing if row.get("milestone_key")}
        metrics = await self._metrics(user_id=user_id)
        return [
            {
                "id": rule.id,
                "type": rule.type,
                "metric": rule.metric,
                "threshold": rule.threshold,
                "label": rule.label,
                "value": metrics.get(rule.metric, 0),
                "earned": rule.id in earned_keys,
            }
            for rule in RULES
        ]
