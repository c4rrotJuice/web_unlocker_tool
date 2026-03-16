from __future__ import annotations

from app.core.account_state import AccountState
from app.core.auth import RequestAuthContext
from app.core.entitlements import CapabilityState


def serialize_module_status(*, module: str, contract: str, notes: list[str] | None = None) -> dict[str, object]:
    return {
        "module": module,
        "schema_contract": contract,
        "status": "active",
        "notes": notes or [],
    }


def serialize_account_state(account_state: AccountState) -> dict[str, object]:
    return {
        "profile": {
            "user_id": account_state.profile.user_id,
            "display_name": account_state.profile.display_name,
            "use_case": account_state.profile.use_case,
        },
        "preferences": {
            "theme": account_state.preferences.theme,
            "editor_density": account_state.preferences.editor_density,
            "default_citation_style": account_state.preferences.default_citation_style,
            "sidebar_collapsed": account_state.preferences.sidebar_collapsed,
            "defaults_applied": account_state.preferences.defaults_applied,
        },
        "entitlement": {
            "tier": account_state.entitlement.tier,
            "status": account_state.entitlement.status,
            "paid_until": account_state.entitlement.paid_until,
            "auto_renew": account_state.entitlement.auto_renew,
            "source": account_state.entitlement.source,
        },
        "billing": {
            "customer": None if account_state.billing_customer is None else {
                "id": account_state.billing_customer.id,
                "provider": account_state.billing_customer.provider,
                "provider_customer_id": account_state.billing_customer.provider_customer_id,
            },
            "subscription": None if account_state.billing_subscription is None else {
                "id": account_state.billing_subscription.id,
                "provider": account_state.billing_subscription.provider,
                "provider_subscription_id": account_state.billing_subscription.provider_subscription_id,
                "provider_price_id": account_state.billing_subscription.provider_price_id,
                "tier": account_state.billing_subscription.tier,
                "status": account_state.billing_subscription.status,
                "current_period_end": account_state.billing_subscription.current_period_end,
                "cancel_at_period_end": account_state.billing_subscription.cancel_at_period_end,
            },
        },
    }


def serialize_capability_state(capability_state: CapabilityState) -> dict[str, object]:
    return {
        "authenticated": capability_state.authenticated,
        "user_id": capability_state.user_id,
        "tier": capability_state.tier,
        "status": capability_state.status,
        "paid_until": capability_state.paid_until,
        "capabilities": {
            "unlocks": capability_state.capabilities["unlocks"],
            "documents": capability_state.capabilities["documents"],
            "exports": capability_state.capabilities["exports"],
            "citation_styles": capability_state.capabilities["citation_styles"],
            "zip_export": capability_state.capabilities["zip_export"],
            "bookmarks": capability_state.capabilities["bookmarks"],
            "reports": capability_state.capabilities["reports"],
            "custom_templates": capability_state.capabilities["custom_templates"],
            "history_search": capability_state.capabilities["history_search"],
            "delete_documents": capability_state.capabilities["delete_documents"],
            "ads": capability_state.capabilities["ads"],
        },
    }


def serialize_request_auth_context(context: RequestAuthContext) -> dict[str, object]:
    return {
        "authenticated": context.authenticated,
        "user_id": context.user_id,
        "supabase_subject": context.supabase_subject,
        "email": context.email,
        "token_claims": context.token_claims,
        "account_state": None if context.account_state is None else serialize_account_state(context.account_state),
        "capability_state": None if context.capability_state is None else serialize_capability_state(context.capability_state),
    }
