from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.errors import AccountNotFoundError


@dataclass(frozen=True)
class UserProfile:
    user_id: str
    display_name: str
    use_case: str | None
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class UserPreferences:
    theme: str = "system"
    editor_density: str = "comfortable"
    default_citation_style: str = "apa"
    sidebar_collapsed: bool = False
    defaults_applied: bool = False
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class UserEntitlement:
    tier: str
    status: str
    paid_until: str | None
    auto_renew: bool
    source: str
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class BillingCustomer:
    id: str | None
    provider: str | None
    provider_customer_id: str | None
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class BillingSubscription:
    id: str | None
    provider: str | None
    provider_subscription_id: str | None
    provider_price_id: str | None
    tier: str | None
    status: str | None
    current_period_end: str | None
    cancel_at_period_end: bool
    payload: dict[str, object]
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(frozen=True)
class AccountState:
    profile: UserProfile
    preferences: UserPreferences
    entitlement: UserEntitlement
    billing_customer: BillingCustomer | None
    billing_subscription: BillingSubscription | None


class AccountStateRepository(Protocol):
    async def fetch_profile(self, user_id: str) -> dict[str, object] | None: ...
    async def fetch_preferences(self, user_id: str) -> dict[str, object] | None: ...
    async def fetch_entitlement(self, user_id: str) -> dict[str, object] | None: ...
    async def fetch_billing_customer(self, user_id: str) -> dict[str, object] | None: ...
    async def fetch_billing_subscription(self, user_id: str) -> dict[str, object] | None: ...


def _normalize_preferences(row: dict[str, object] | None) -> UserPreferences:
    row = row or {}
    defaults_applied = not bool(row)
    return UserPreferences(
        theme=str(row.get("theme") or "system"),
        editor_density=str(row.get("editor_density") or "comfortable"),
        default_citation_style=str(row.get("default_citation_style") or "apa"),
        sidebar_collapsed=bool(row.get("sidebar_collapsed") or False),
        defaults_applied=defaults_applied,
        created_at=row.get("created_at") if isinstance(row.get("created_at"), str) else None,
        updated_at=row.get("updated_at") if isinstance(row.get("updated_at"), str) else None,
    )


def _normalize_billing_customer(row: dict[str, object] | None) -> BillingCustomer | None:
    if not row:
        return None
    return BillingCustomer(
        id=row.get("id") if isinstance(row.get("id"), str) else None,
        provider=row.get("provider") if isinstance(row.get("provider"), str) else None,
        provider_customer_id=row.get("provider_customer_id") if isinstance(row.get("provider_customer_id"), str) else None,
        created_at=row.get("created_at") if isinstance(row.get("created_at"), str) else None,
        updated_at=row.get("updated_at") if isinstance(row.get("updated_at"), str) else None,
    )


def _normalize_billing_subscription(row: dict[str, object] | None) -> BillingSubscription | None:
    if not row:
        return None
    payload = row.get("payload")
    return BillingSubscription(
        id=row.get("id") if isinstance(row.get("id"), str) else None,
        provider=row.get("provider") if isinstance(row.get("provider"), str) else None,
        provider_subscription_id=row.get("provider_subscription_id") if isinstance(row.get("provider_subscription_id"), str) else None,
        provider_price_id=row.get("provider_price_id") if isinstance(row.get("provider_price_id"), str) else None,
        tier=row.get("tier") if isinstance(row.get("tier"), str) else None,
        status=row.get("status") if isinstance(row.get("status"), str) else None,
        current_period_end=row.get("current_period_end") if isinstance(row.get("current_period_end"), str) else None,
        cancel_at_period_end=bool(row.get("cancel_at_period_end") or False),
        payload=payload if isinstance(payload, dict) else {},
        created_at=row.get("created_at") if isinstance(row.get("created_at"), str) else None,
        updated_at=row.get("updated_at") if isinstance(row.get("updated_at"), str) else None,
    )


class AccountStateService:
    def __init__(self, repository: AccountStateRepository):
        self.repository = repository

    async def load(self, user_id: str) -> AccountState:
        profile_row = await self.repository.fetch_profile(user_id)
        preferences_row = await self.repository.fetch_preferences(user_id)
        entitlement_row = await self.repository.fetch_entitlement(user_id)
        if not profile_row or not preferences_row or not entitlement_row:
            raise AccountNotFoundError()

        profile = UserProfile(
            user_id=user_id,
            display_name=str(profile_row.get("display_name") or "User"),
            use_case=profile_row.get("use_case") if isinstance(profile_row.get("use_case"), str) else None,
            created_at=profile_row.get("created_at") if isinstance(profile_row.get("created_at"), str) else None,
            updated_at=profile_row.get("updated_at") if isinstance(profile_row.get("updated_at"), str) else None,
        )
        entitlement = UserEntitlement(
            tier=str(entitlement_row.get("tier") or "free"),
            status=str(entitlement_row.get("status") or "active"),
            paid_until=entitlement_row.get("paid_until") if isinstance(entitlement_row.get("paid_until"), str) else None,
            auto_renew=bool(entitlement_row.get("auto_renew") or False),
            source=str(entitlement_row.get("source") or "system"),
            created_at=entitlement_row.get("created_at") if isinstance(entitlement_row.get("created_at"), str) else None,
            updated_at=entitlement_row.get("updated_at") if isinstance(entitlement_row.get("updated_at"), str) else None,
        )
        preferences = _normalize_preferences(preferences_row)
        billing_customer = _normalize_billing_customer(await self.repository.fetch_billing_customer(user_id))
        billing_subscription = _normalize_billing_subscription(await self.repository.fetch_billing_subscription(user_id))
        return AccountState(
            profile=profile,
            preferences=preferences,
            entitlement=entitlement,
            billing_customer=billing_customer,
            billing_subscription=billing_subscription,
        )
