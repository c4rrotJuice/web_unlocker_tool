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


def serialize_paging_meta(*, next_cursor: str | None, has_more: bool) -> dict[str, object]:
    return {
        "next_cursor": next_cursor,
        "has_more": has_more,
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


def serialize_project(row: dict[str, object]) -> dict[str, object]:
    status = str(row.get("status") or "active")
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "color": row.get("color"),
        "description": row.get("description"),
        "icon": row.get("icon"),
        "archived": status == "archived",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_tag(row: dict[str, object]) -> dict[str, object]:
    name = str(row.get("name") or "")
    return {
        "id": row.get("id"),
        "name": name,
        "normalized_name": name.strip().lower() or None,
    }


def serialize_source_summary(row: dict[str, object], *, relationship_counts: dict[str, int] | None = None) -> dict[str, object]:
    authors = row.get("authors") if isinstance(row.get("authors"), list) else []
    identifiers = row.get("identifiers") if isinstance(row.get("identifiers"), dict) else {}
    issued_date = row.get("issued_date") if isinstance(row.get("issued_date"), dict) else {}
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "source_type": row.get("source_type"),
        "authors": authors,
        "container_title": row.get("container_title"),
        "publisher": row.get("publisher"),
        "issued_date": issued_date,
        "identifiers": identifiers,
        "canonical_url": row.get("canonical_url"),
        "page_url": row.get("page_url"),
        "hostname": row.get("hostname"),
        "language_code": row.get("language_code"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "relationship_counts": relationship_counts or {},
    }


def serialize_source_detail(row: dict[str, object], *, relationship_counts: dict[str, int] | None = None) -> dict[str, object]:
    payload = serialize_source_summary(row, relationship_counts=relationship_counts)
    payload.update(
        {
            "fingerprint": row.get("fingerprint"),
            "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            "normalization_version": row.get("normalization_version"),
            "source_version": row.get("source_version"),
        }
    )
    return payload


def serialize_citation_template(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "template_body": row.get("template_body"),
        "is_default": bool(row.get("is_default") or False),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_citation(
    row: dict[str, object],
    *,
    source: dict[str, object],
    renders: dict[str, dict[str, str]],
    relationship_counts: dict[str, int] | None = None,
) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "source_id": row.get("source_id"),
        "source": source,
        "locator": row.get("locator") if isinstance(row.get("locator"), dict) else {},
        "annotation": row.get("annotation"),
        "excerpt": row.get("excerpt"),
        "quote_text": row.get("quote_text"),
        "renders": renders,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "relationship_counts": relationship_counts or {},
    }


def serialize_quote(row: dict[str, object], *, citation: dict[str, object] | None, note_ids: list[str] | None = None) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "excerpt": row.get("excerpt") or "",
        "locator": row.get("locator") if isinstance(row.get("locator"), dict) else {},
        "annotation": row.get("annotation"),
        "citation": citation,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "note_ids": list(note_ids or []),
    }


def serialize_note_source(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "source_id": row.get("source_id"),
        "citation_id": row.get("citation_id"),
        "relation_type": row.get("relation_type") or "external",
        "url": row.get("url"),
        "hostname": row.get("hostname"),
        "title": row.get("title"),
        "source_author": row.get("source_author"),
        "source_published_at": row.get("source_published_at"),
        "display": row.get("display") if isinstance(row.get("display"), dict) else {},
        "attached_at": row.get("attached_at"),
        "position": row.get("position"),
    }


def serialize_note(
    row: dict[str, object],
    *,
    tags: list[dict[str, object]],
    linked_note_ids: list[str],
    sources: list[dict[str, object]],
) -> dict[str, object]:
    title = row.get("title")
    return {
        "id": row.get("id"),
        "title": "" if title is None else str(title),
        "note_body": row.get("note_body") or "",
        "highlight_text": row.get("highlight_text"),
        "project_id": row.get("project_id"),
        "citation_id": row.get("citation_id"),
        "quote_id": row.get("quote_id"),
        "tags": tags,
        "linked_note_ids": linked_note_ids,
        "sources": sources,
        "status": row.get("status") or "active",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_activity_event(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "event_type": row.get("event_type"),
        "domain": row.get("domain"),
        "url": row.get("url"),
        "source": row.get("source"),
        "was_cleaned": bool(row.get("was_cleaned")) if row.get("was_cleaned") is not None else None,
        "created_at": row.get("created_at"),
    }


def serialize_bookmark(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "url": row.get("url"),
        "domain": row.get("domain"),
        "title": row.get("title"),
        "saved_from": row.get("saved_from"),
        "created_at": row.get("created_at"),
    }


def serialize_milestone(row: dict[str, object], *, label: str) -> dict[str, object]:
    return {
        "key": row.get("milestone_key"),
        "label": label,
        "achieved_at": row.get("awarded_at"),
        "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
    }


def serialize_momentum_summary(payload: dict[str, object]) -> dict[str, object]:
    return {
        "current_streak_days": int(payload.get("current_streak_days") or 0),
        "active_days_this_month": int(payload.get("active_days_this_month") or 0),
        "unlocks_this_month": int(payload.get("unlocks_this_month") or 0),
        "captures_this_month": int(payload.get("captures_this_month") or 0),
        "copy_assists_this_month": int(payload.get("copy_assists_this_month") or 0),
        "total_activity_this_month": int(payload.get("total_activity_this_month") or 0),
        "documents_updated_this_month": int(payload.get("documents_updated_this_month") or 0),
    }


def serialize_domain_insight(row: dict[str, object]) -> dict[str, object]:
    return {
        "domain": row.get("domain"),
        "count": int(row.get("count") or 0),
    }


def serialize_citation_style_insight(row: dict[str, object]) -> dict[str, object]:
    return {
        "style": row.get("style"),
        "count": int(row.get("count") or 0),
    }


def serialize_monthly_summary(payload: dict[str, object]) -> dict[str, object]:
    return {
        "month": payload.get("month"),
        "range": payload.get("range"),
        "timezone": payload.get("timezone"),
        "momentum": payload.get("momentum") or {},
        "domains": payload.get("domains") or [],
        "citation_styles": payload.get("citation_styles") or [],
        "milestones": payload.get("milestones") or [],
        "report": payload.get("report") or {},
    }


def serialize_monthly_report(payload: dict[str, object]) -> dict[str, object]:
    return {
        "month": payload.get("month"),
        "range": payload.get("range"),
        "status": payload.get("status"),
        "available": bool(payload.get("available") or False),
        "generated_at": payload.get("generated_at"),
        "download_url": payload.get("download_url"),
        "supported_formats": payload.get("supported_formats") or [],
        "sections": payload.get("sections") or {},
        "completeness": payload.get("completeness"),
        "missing_sections": payload.get("missing_sections") or [],
        "timezone": payload.get("timezone"),
    }


def serialize_document(
    row: dict[str, object],
    *,
    attached_citation_ids: list[str],
    attached_note_ids: list[str],
    tag_ids: list[str],
    tags: list[dict[str, object]],
    can_edit: bool,
    allowed_export_formats: list[str],
    edit_lock_reason: str | None = None,
) -> dict[str, object]:
    status = str(row.get("status") or "active")
    return {
        "id": row.get("id"),
        "title": row.get("title") or "Untitled",
        "content_delta": row.get("content_delta"),
        "content_html": row.get("content_html"),
        "project_id": row.get("project_id"),
        "status": status,
        "archived": status == "archived",
        "attached_citation_ids": attached_citation_ids,
        "attached_note_ids": attached_note_ids,
        "tag_ids": tag_ids,
        "tags": tags,
        "can_edit": can_edit,
        "allowed_export_formats": allowed_export_formats,
        "edit_lock_reason": edit_lock_reason,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_checkpoint(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row.get("id"),
        "document_id": row.get("document_id"),
        "label": row.get("label"),
        "created_at": row.get("created_at"),
    }


def serialize_document_hydration(
    *,
    document: dict[str, object],
    attached_citations: list[dict[str, object]],
    attached_notes: list[dict[str, object]],
    attached_quotes: list[dict[str, object]] | None = None,
    attached_sources: list[dict[str, object]] | None = None,
    seed: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "document": document,
        "attached_citations": attached_citations,
        "attached_notes": attached_notes,
        "attached_quotes": attached_quotes or [],
        "attached_sources": attached_sources or [],
        "seed": seed,
    }


def serialize_outline(items: list[dict[str, object]]) -> dict[str, object]:
    return {"items": items}
