from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.services.entitlements import FREE_TIER, PRO_TIER, STANDARD_TIER, normalize_account_type

FREE_UNLOCKS_PER_WEEK = 10
STANDARD_UNLOCKS_PER_DAY = 15
FREE_DOCS_PER_WEEK = 3
STANDARD_DOCS_PER_14_DAYS = 15
STANDARD_DOC_WINDOW_DAYS = 14
FREE_ALLOWED_CITATION_FORMATS = {"apa", "mla"}
STANDARD_ALLOWED_CITATION_FORMATS = {"apa", "mla", "chicago", "harvard"}
FREE_ALLOWED_EXPORT_FORMATS = {"pdf"}
STANDARD_ALLOWED_EXPORT_FORMATS = {"pdf", "docx", "txt"}
PRO_ALLOWED_EXPORT_FORMATS = {"pdf", "docx", "txt"}

ARCHIVED_DOC_MESSAGE = "This document is archived. Upgrade to Pro to restore editing."
STANDARD_DOC_LIMIT_MESSAGE = "Document limit reached for this period. Upgrade to Pro for unlimited access."


@dataclass(frozen=True)
class UnlockWindow:
    key: str
    limit: int
    usage_period: str
    reset_at: str
    ttl_seconds: int


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def current_week_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = (now or utc_now()).astimezone(timezone.utc)
    start = current - timedelta(days=current.isoweekday() - 1)
    start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    return start, start + timedelta(days=7)


def current_utc_day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = (now or utc_now()).astimezone(timezone.utc)
    start = datetime(current.year, current.month, current.day, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def rolling_window(now: datetime | None = None, days: int = STANDARD_DOC_WINDOW_DAYS) -> tuple[datetime, datetime]:
    if days == STANDARD_DOC_WINDOW_DAYS:
        return current_14_day_window(now)
    current = (now or utc_now()).astimezone(timezone.utc)
    return current - timedelta(days=days), current



def current_14_day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = (now or utc_now()).astimezone(timezone.utc)
    day_start = datetime(current.year, current.month, current.day, tzinfo=timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    day_index = int((day_start - epoch).total_seconds() // 86400)
    window_index = day_index // STANDARD_DOC_WINDOW_DAYS
    start = epoch + timedelta(days=window_index * STANDARD_DOC_WINDOW_DAYS)
    return start, start + timedelta(days=STANDARD_DOC_WINDOW_DAYS)

def week_key(now: datetime | None = None) -> str:
    current = (now or utc_now()).astimezone(timezone.utc)
    iso_year, iso_week, _ = current.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def utc_day_key(now: datetime | None = None) -> str:
    return (now or utc_now()).astimezone(timezone.utc).strftime("%Y-%m-%d")


def seconds_until_reset(now: datetime | None = None) -> int:
    current = (now or utc_now()).astimezone(timezone.utc)
    _, reset_at = current_week_window(current)
    return max(int((reset_at - current).total_seconds()), 60)


def is_free_authenticated(account_type: str | None, user_id: str | None = None) -> bool:
    return bool(user_id) and normalize_account_type(account_type) == FREE_TIER


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def doc_window_start(account_type: str | None, now: datetime | None = None) -> datetime | None:
    tier = normalize_account_type(account_type)
    current = (now or utc_now()).astimezone(timezone.utc)
    if tier == FREE_TIER:
        start, _ = current_week_window(current)
        return start
    if tier == STANDARD_TIER:
        start, _ = rolling_window(current, STANDARD_DOC_WINDOW_DAYS)
        return start
    return None


def doc_is_archived(created_at: str | None, account_type: str | None, now: datetime | None = None) -> bool:
    parsed = parse_iso_datetime(created_at)
    if not parsed:
        return False
    start = doc_window_start(account_type, now)
    if not start:
        return False
    return parsed < start


def doc_is_archived_for_free(created_at: str | None, now: datetime | None = None) -> bool:
    return doc_is_archived(created_at, FREE_TIER, now)


def allowed_export_formats(account_type: str | None) -> set[str]:
    tier = normalize_account_type(account_type)
    if tier == FREE_TIER:
        return set(FREE_ALLOWED_EXPORT_FORMATS)
    if tier == STANDARD_TIER:
        return set(STANDARD_ALLOWED_EXPORT_FORMATS)
    return set(PRO_ALLOWED_EXPORT_FORMATS)


def allowed_citation_formats(account_type: str | None) -> set[str]:
    tier = normalize_account_type(account_type)
    if tier == FREE_TIER:
        return set(FREE_ALLOWED_CITATION_FORMATS)
    if tier == STANDARD_TIER:
        return set(STANDARD_ALLOWED_CITATION_FORMATS)
    if tier == PRO_TIER:
        return set(STANDARD_ALLOWED_CITATION_FORMATS | {"custom"})
    return set(FREE_ALLOWED_CITATION_FORMATS)


def unlock_window_for_tier(account_type: str | None, user_id: str, now: datetime | None = None) -> UnlockWindow | None:
    tier = normalize_account_type(account_type)
    current = (now or utc_now()).astimezone(timezone.utc)
    if tier == PRO_TIER:
        return None
    if tier == STANDARD_TIER:
        _start, reset_at = current_utc_day_window(current)
        return UnlockWindow(
            key=f"extension_usage_day:{user_id}:{utc_day_key(current)}",
            limit=STANDARD_UNLOCKS_PER_DAY,
            usage_period="day",
            reset_at=reset_at.isoformat(),
            ttl_seconds=max(int((reset_at - current).total_seconds()), 60),
        )

    _start, reset_at = current_week_window(current)
    return UnlockWindow(
        key=f"extension_usage_week:{user_id}:{week_key(current)}",
        limit=FREE_UNLOCKS_PER_WEEK,
        usage_period="week",
        reset_at=reset_at.isoformat(),
        ttl_seconds=max(int((reset_at - current).total_seconds()), 60),
    )
