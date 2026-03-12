from datetime import datetime, timedelta, timezone

from app.routes.dashboard import _has_active_subscription


def test_has_active_subscription_for_paid_tier_without_paid_until():
    assert _has_active_subscription("pro", None) is True


def test_has_active_subscription_for_free_tier_with_future_paid_until():
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    assert _has_active_subscription("free", future) is True


def test_has_active_subscription_for_free_tier_with_past_paid_until():
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert _has_active_subscription("free", past) is False


def test_has_active_subscription_for_free_tier_with_invalid_paid_until():
    assert _has_active_subscription("free", "not-a-date") is False
