from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.entitlements import FREE_TIER, normalize_account_type

FREE_UNLOCKS_PER_WEEK = 10
FREE_DOCS_PER_WEEK = 3
FREE_ALLOWED_CITATION_FORMATS = {"apa", "mla"}
FREE_ALLOWED_EXPORT_FORMATS = {"pdf"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def current_week_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = now or utc_now()
    current = current.astimezone(timezone.utc)
    start = current - timedelta(days=current.isoweekday() - 1)
    start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    return start, start + timedelta(days=7)


def week_key(now: datetime | None = None) -> str:
    current = (now or utc_now()).astimezone(timezone.utc)
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def is_free_authenticated(account_type: str | None, user_id: str | None = None) -> bool:
    return bool(user_id) and normalize_account_type(account_type) == FREE_TIER


def seconds_until_reset(now: datetime | None = None) -> int:
    current = now or utc_now()
    _, reset_at = current_week_window(current)
    return max(int((reset_at - current.astimezone(timezone.utc)).total_seconds()), 60)


def doc_is_archived_for_free(created_at: str | None, now: datetime | None = None) -> bool:
    if not created_at:
        return False
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return False
    week_start, _ = current_week_window(now)
    return parsed < week_start
