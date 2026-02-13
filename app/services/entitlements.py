from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

FREE_TIER = "free"
STANDARD_TIER = "standard"
PRO_TIER = "pro"

LEGACY_TIER_MAP = {
    "freemium": FREE_TIER,
    "premium": STANDARD_TIER,
}


@dataclass(frozen=True)
class TierCapabilities:
    queue_priority: int
    has_unlock_limits: bool
    unlock_usage_period: str | None
    unlock_limit: int | None
    has_document_quota: bool
    document_limit: int | None
    document_window_days: int | None
    freeze_documents: bool
    can_delete_documents: bool
    allowed_export_formats: frozenset[str]
    can_zip_export: bool
    allowed_citation_formats: frozenset[str]
    can_use_custom_citation_templates: bool


TIER_CAPABILITIES: dict[str, TierCapabilities] = {
    FREE_TIER: TierCapabilities(
        queue_priority=2,
        has_unlock_limits=True,
        unlock_usage_period="week",
        unlock_limit=10,
        has_document_quota=True,
        document_limit=3,
        document_window_days=7,
        freeze_documents=True,
        can_delete_documents=False,
        allowed_export_formats=frozenset({"pdf"}),
        can_zip_export=False,
        allowed_citation_formats=frozenset({"apa", "mla"}),
        can_use_custom_citation_templates=False,
    ),
    STANDARD_TIER: TierCapabilities(
        queue_priority=1,
        has_unlock_limits=True,
        unlock_usage_period="day",
        unlock_limit=15,
        has_document_quota=True,
        document_limit=15,
        document_window_days=14,
        freeze_documents=True,
        can_delete_documents=False,
        allowed_export_formats=frozenset({"pdf", "docx", "txt"}),
        can_zip_export=False,
        allowed_citation_formats=frozenset({"apa", "mla", "chicago", "harvard"}),
        can_use_custom_citation_templates=False,
    ),
    PRO_TIER: TierCapabilities(
        queue_priority=0,
        has_unlock_limits=False,
        unlock_usage_period=None,
        unlock_limit=None,
        has_document_quota=False,
        document_limit=None,
        document_window_days=None,
        freeze_documents=False,
        can_delete_documents=True,
        allowed_export_formats=frozenset({"pdf", "docx", "txt"}),
        can_zip_export=True,
        allowed_citation_formats=frozenset({"apa", "mla", "chicago", "harvard", "custom"}),
        can_use_custom_citation_templates=True,
    ),
}


def normalize_account_type(account_type: Optional[str]) -> str:
    if not account_type:
        return FREE_TIER
    normalized = account_type.strip().lower()
    return LEGACY_TIER_MAP.get(normalized, normalized)


def get_tier_capabilities(account_type: Optional[str]) -> TierCapabilities:
    tier = normalize_account_type(account_type)
    return TIER_CAPABILITIES.get(tier, TIER_CAPABILITIES[FREE_TIER])


def can_use_cloudscraper(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier in {STANDARD_TIER, PRO_TIER}


def has_daily_limit(account_type: Optional[str]) -> bool:
    return get_tier_capabilities(account_type).has_unlock_limits


def can_use_bookmarks(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier in {STANDARD_TIER, PRO_TIER}


def can_use_history_search(account_type: Optional[str]) -> bool:
    tier = normalize_account_type(account_type)
    return tier in {STANDARD_TIER, PRO_TIER}


def should_show_ads(account_type: Optional[str]) -> bool:
    return normalize_account_type(account_type) == FREE_TIER


def queue_priority(account_type: Optional[str]) -> int:
    return get_tier_capabilities(account_type).queue_priority
