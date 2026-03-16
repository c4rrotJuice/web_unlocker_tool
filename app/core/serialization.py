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


def serialize_ok_envelope(data: object, *, meta: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "ok": True,
        "data": data,
        "meta": meta or {},
        "error": None,
    }


def serialize_profile(profile) -> dict[str, object]:
    return {
        "id": profile.user_id,
        "display_name": profile.display_name,
        "use_case": profile.use_case,
    }


def serialize_preferences(preferences) -> dict[str, object]:
    return {
        "theme": preferences.theme,
        "editor_density": preferences.editor_density,
        "default_citation_style": preferences.default_citation_style,
        "sidebar_collapsed": preferences.sidebar_collapsed,
    }


def serialize_entitlement(entitlement) -> dict[str, object]:
    return {
        "tier": entitlement.tier,
        "status": entitlement.status,
        "paid_until": entitlement.paid_until,
        "auto_renew": entitlement.auto_renew,
    }


def serialize_capability_object(capability_state: CapabilityState) -> dict[str, object]:
    return {
        "tier": capability_state.tier,
        "unlocks": capability_state.capabilities["unlocks"],
        "documents": capability_state.capabilities["documents"],
        "exports": capability_state.capabilities["exports"],
        "citation_styles": capability_state.capabilities["citation_styles"],
        "zip_export": capability_state.capabilities["zip_export"],
        "custom_templates": capability_state.capabilities["custom_templates"],
        "bookmarks": capability_state.capabilities["bookmarks"],
        "history_search": capability_state.capabilities["history_search"],
        "reports": capability_state.capabilities["reports"],
    }


def serialize_account_bootstrap(account_state: AccountState, capability_state: CapabilityState) -> dict[str, object]:
    return {
        "user": serialize_profile(account_state.profile),
        "preferences": serialize_preferences(account_state.preferences),
        "entitlement": serialize_entitlement(account_state.entitlement),
        "capabilities": serialize_capability_object(capability_state),
    }


def serialize_billing_customer(customer) -> dict[str, object]:
    if customer is None:
        return {
            "exists": False,
            "customer_id": None,
            "provider": None,
            "created_at": None,
        }
    return {
        "exists": True,
        "customer_id": customer.provider_customer_id,
        "provider": customer.provider,
        "created_at": customer.created_at,
    }


def serialize_billing_subscription(subscription) -> dict[str, object]:
    if subscription is None:
        return {
            "exists": False,
            "status": "none",
            "plan_code": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
        }
    return {
        "exists": True,
        "status": subscription.status,
        "plan_code": subscription.provider_price_id,
        "current_period_end": subscription.current_period_end,
        "cancel_at_period_end": subscription.cancel_at_period_end,
    }


def serialize_account_state(account_state: AccountState) -> dict[str, object]:
    return {
        "profile": serialize_profile(account_state.profile),
        "preferences": {
            **serialize_preferences(account_state.preferences),
            "defaults_applied": account_state.preferences.defaults_applied,
        },
        "entitlement": {
            **serialize_entitlement(account_state.entitlement),
            "source": account_state.entitlement.source,
        },
        "billing": {
            "customer": serialize_billing_customer(account_state.billing_customer),
            "subscription": serialize_billing_subscription(account_state.billing_subscription),
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
