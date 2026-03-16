from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import CapabilityForbiddenError


ALLOWED_TIERS = {"free", "standard", "pro", "dev"}
ALLOWED_STATUSES = {"active", "grace_period", "expired", "canceled"}


@dataclass(frozen=True)
class CapabilityState:
    authenticated: bool
    user_id: str
    tier: str
    status: str
    paid_until: str | None
    capabilities: dict[str, object]


def normalize_tier(value: str | None) -> str:
    normalized = (value or "free").strip().lower()
    return normalized if normalized in ALLOWED_TIERS else "free"


def normalize_status(value: str | None) -> str:
    normalized = (value or "active").strip().lower()
    return normalized if normalized in ALLOWED_STATUSES else "active"


def _is_paid(tier: str, status: str) -> bool:
    return tier in {"standard", "pro", "dev"} and status in {"active", "grace_period"}


def _is_pro(tier: str, status: str) -> bool:
    return tier in {"pro", "dev"} and status in {"active", "grace_period"}


def derive_capability_state(
    *,
    user_id: str,
    tier: str | None,
    status: str | None,
    paid_until: str | None,
) -> CapabilityState:
    normalized_tier = normalize_tier(tier)
    normalized_status = normalize_status(status)
    paid = _is_paid(normalized_tier, normalized_status)
    pro = _is_pro(normalized_tier, normalized_status)

    unlock_limit: int | None
    document_limit: int | None
    if pro:
        unlock_limit = None
        document_limit = None
    elif paid:
        unlock_limit = 15
        document_limit = 25
    else:
        unlock_limit = 10
        document_limit = 3

    capabilities = {
        "unlocks": {
            "limit": unlock_limit,
            "window": "week" if not paid else "day",
            "priority": "paid" if paid else "standard",
        },
        "documents": {
            "limit": document_limit,
            "window": "week" if not paid else "month",
            "freeze": not paid,
        },
        "exports": ["pdf", "html"] if not pro else ["pdf", "html", "docx", "md"],
        "citation_styles": ["apa", "mla"] if not pro else ["apa", "mla", "chicago", "harvard", "custom"],
        "zip_export": pro,
        "bookmarks": paid,
        "reports": paid,
        "custom_templates": pro,
        "history_search": paid,
        "delete_documents": pro,
        "ads": not paid,
    }
    return CapabilityState(
        authenticated=True,
        user_id=user_id,
        tier=normalized_tier,
        status=normalized_status,
        paid_until=paid_until,
        capabilities=capabilities,
    )


def build_capability_state(*, user_id: str = "user-1", tier: str | None, status: str | None, paid_until: str | None = None) -> dict[str, object]:
    state = derive_capability_state(user_id=user_id, tier=tier, status=status, paid_until=paid_until)
    return {
        "authenticated": state.authenticated,
        "user_id": state.user_id,
        "tier": state.tier,
        "status": state.status,
        "paid_until": state.paid_until,
        "capabilities": dict(state.capabilities),
    }


def require_capability(capability_name: str, capability_state: dict[str, object] | CapabilityState) -> None:
    if isinstance(capability_state, CapabilityState):
        capabilities = capability_state.capabilities
    else:
        capabilities = capability_state
    allowed = capabilities.get(capability_name)
    if allowed is not True:
        raise CapabilityForbiddenError(f"Capability '{capability_name}' is not permitted.")
