from datetime import date, timedelta

from app.services.momentum import calculate_streak, determine_new_milestones


def test_calculate_streak_with_today_activity():
    today = date(2025, 1, 10)
    active_days = {today, today - timedelta(days=1), today - timedelta(days=2)}
    streak, has_today = calculate_streak(active_days, today)
    assert streak == 3
    assert has_today is True


def test_calculate_streak_without_today_activity():
    today = date(2025, 1, 10)
    active_days = {today - timedelta(days=1), today - timedelta(days=2)}
    streak, has_today = calculate_streak(active_days, today)
    assert streak == 2
    assert has_today is False


def test_determine_new_milestones_dedup():
    metrics = {
        "current_streak_days": 7,
        "articles_unlocked_all_time": 55,
        "active_days_mtd": 12,
    }
    existing = {"first_7_day_streak"}
    milestones = determine_new_milestones(metrics, existing)
    keys = {item["key"] for item in milestones}
    assert "first_7_day_streak" not in keys
    assert "fifty_unlocks" in keys
    assert "consistency_unlocked" in keys
