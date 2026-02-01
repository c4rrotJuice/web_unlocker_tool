from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable


@dataclass(frozen=True)
class MilestoneConfig:
    key: str
    title: str
    metric: str
    threshold: int


MILESTONE_CONFIG = [
    MilestoneConfig(
        key="first_7_day_streak",
        title="🔥 First 7-day streak",
        metric="current_streak_days",
        threshold=7,
    ),
    MilestoneConfig(
        key="fifty_unlocks",
        title="📖 50 articles unlocked",
        metric="articles_unlocked_all_time",
        threshold=50,
    ),
    MilestoneConfig(
        key="consistency_unlocked",
        title="🧠 Consistency unlocked",
        metric="active_days_mtd",
        threshold=12,
    ),
]


def calculate_streak(active_days: Iterable[date], today: date) -> tuple[int, bool]:
    day_set = set(active_days)
    has_unlock_today = today in day_set
    cursor = today if has_unlock_today else today - timedelta(days=1)
    streak = 0
    while cursor in day_set:
        streak += 1
        cursor -= timedelta(days=1)
    return streak, has_unlock_today


def count_active_days_in_range(
    active_days: Iterable[date],
    start: date,
    end: date,
) -> int:
    return sum(1 for day in active_days if start <= day < end)


def determine_new_milestones(
    metrics: dict,
    existing_keys: set[str],
) -> list[dict]:
    awarded = []
    for milestone in MILESTONE_CONFIG:
        if milestone.key in existing_keys:
            continue
        value = metrics.get(milestone.metric, 0)
        if value >= milestone.threshold:
            awarded.append(
                {
                    "key": milestone.key,
                    "title": milestone.title,
                    "threshold": milestone.threshold,
                }
            )
    return awarded
