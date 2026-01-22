from __future__ import annotations

from typing import Optional

FREE_TIER = "free"
STANDARD_TIER = "standard"
PRO_TIER = "pro"

LEGACY_TIER_MAP = {
    "freemium": FREE_TIER,
    "premium": STANDARD_TIER,
}


def normalize_account_type(account_type: Optional[str]) -> str:
    if not account_type:
        return FREE_TIER
    normalized = account_type.strip().lower()
    return LEGACY_TIER_MAP.get(normalized, normalized)


def can_use_cloudscraper(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier in {STANDARD_TIER, PRO_TIER}


def has_daily_limit(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier == FREE_TIER


def can_use_bookmarks(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier in {STANDARD_TIER, PRO_TIER}


def can_use_history_search(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier == PRO_TIER


def should_show_ads(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier == FREE_TIER
