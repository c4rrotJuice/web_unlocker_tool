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

    async def _metric(self, *, user_id: str, metric: str) -> int:
        if metric == "current_streak":
            state = await self.repository.get_activity_state(user_id=user_id) or {}
            return int(state.get("current_streak") or 0)
        if metric in {"source_captured", "note_created", "citation_created"}:
            return await self.repository.count_activity_events(user_id=user_id, event_type=metric)
        if metric == "documents_total":
            return await self.repository.count_documents_for_user(user_id=user_id)
        if metric == "document_citations_total":
            return await self.repository.count_document_citations_for_user(user_id=user_id)
        return 0

    async def _metrics(self, *, user_id: str, rules: tuple[MilestoneRule, ...]) -> dict[str, int]:
        metrics: dict[str, int] = {}
        for metric in {rule.metric for rule in rules}:
            metrics[metric] = await self._metric(user_id=user_id, metric=metric)
        return metrics

    async def evaluate_milestones(self, user_id: str) -> list[dict[str, object]]:
        existing = await self.repository.list_milestones(user_id=user_id)
        existing_keys = {str(row.get("milestone_key")) for row in existing if row.get("milestone_key")}
        pending_rules = tuple(rule for rule in RULES if rule.id not in existing_keys)
        if not pending_rules:
            return []
        metrics = await self._metrics(user_id=user_id, rules=pending_rules)

        awarded: list[dict[str, object]] = []
        for rule in pending_rules:
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

    async def evaluate(self, *, user_id: str, streak: dict[str, Any] | None = None) -> list[dict[str, object]]:
        return await self.evaluate_milestones(user_id)

    async def progress(self, *, user_id: str) -> list[dict[str, object]]:
        existing = await self.repository.list_milestones(user_id=user_id)
        earned_keys = {str(row.get("milestone_key")) for row in existing if row.get("milestone_key")}
        metrics = await self._metrics(user_id=user_id, rules=RULES)
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
