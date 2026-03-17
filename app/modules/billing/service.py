from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging

from fastapi import Request

from app.core.account_state import BillingCustomer, BillingSubscription
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.serialization import (
    serialize_billing_customer,
    serialize_billing_subscription,
    serialize_module_status,
    serialize_ok_envelope,
)
from app.modules.billing.repo import BillingRepository


logger = logging.getLogger(__name__)

PRICE_ID_TO_TIER = {
    "pri_01kf77v5j5j1b0fkwb95p0wxew": "standard",
    "pri_01kf77xyfjdh0rr66caz2dnye7": "standard",
    "pri_01kf781jrxcwtg70bxky3316fr": "pro",
    "pri_01kf7839fptpnr6wtgwcnkwe1r": "pro",
}
PADDLE_ACTIVE_STATUSES = {"active", "trialing"}
PADDLE_GRACE_STATUSES = {"past_due"}
PADDLE_CANCEL_EVENTS = {
    "subscription.canceled",
    "subscription.cancelled",
    "subscription.deleted",
    "subscription.ended",
}
PADDLE_SUBSCRIPTION_EVENTS = {
    "subscription.created",
    "subscription.updated",
    "subscription.renewed",
    "subscription.activated",
} | PADDLE_CANCEL_EVENTS


class BillingWebhookError(AppError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(code, message, status_code)


class BillingService:
    def __init__(self, *, repository: BillingRepository):
        self.repository = repository

    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="billing",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Billing reads come from billing_customers and billing_subscriptions only.",
                "Billing webhook mutation is limited to canonical billing and entitlement tables.",
            ],
        )

    async def customer(self, user_id: str) -> dict[str, object]:
        row = await self.repository.fetch_customer(user_id)
        customer = None
        if row:
            customer = BillingCustomer(
                id=row.get("id") if isinstance(row.get("id"), str) else None,
                provider=row.get("provider") if isinstance(row.get("provider"), str) else None,
                provider_customer_id=row.get("provider_customer_id") if isinstance(row.get("provider_customer_id"), str) else None,
                created_at=row.get("created_at") if isinstance(row.get("created_at"), str) else None,
                updated_at=row.get("updated_at") if isinstance(row.get("updated_at"), str) else None,
            )
        return serialize_ok_envelope(serialize_billing_customer(customer))

    async def subscription(self, user_id: str) -> dict[str, object]:
        row = await self.repository.fetch_subscription(user_id)
        subscription = None
        if row:
            payload = row.get("payload")
            subscription = BillingSubscription(
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
        return serialize_ok_envelope(serialize_billing_subscription(subscription))

    def _verify_signature(self, raw_body: bytes, signature_header: str | None) -> None:
        secret = get_settings().paddle_webhook_secret
        if not secret:
            raise BillingWebhookError("billing_webhook_secret_missing", "Billing webhook secret is not configured.", 500)
        normalized = (signature_header or "").replace(";", ",")
        parts: dict[str, list[str]] = {}
        for part in normalized.split(","):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            if key:
                parts.setdefault(key, []).append(value.strip().strip('"'))
        timestamp = next(iter(parts.get("ts") or parts.get("t") or []), "")
        candidates = [value for value in (parts.get("v1") or parts.get("h1") or parts.get("sig") or []) if value]
        if not timestamp or not candidates:
            raise BillingWebhookError("billing_webhook_invalid_signature", "Invalid webhook signature.", 400)
        expected = hmac.new(
            secret.encode("utf-8"),
            f"{timestamp}:{raw_body.decode('utf-8')}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not any(hmac.compare_digest(candidate, expected) for candidate in candidates):
            raise BillingWebhookError("billing_webhook_invalid_signature", "Invalid webhook signature.", 400)

    def _payload_json(self, raw_body: bytes) -> dict[str, object]:
        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise BillingWebhookError("billing_webhook_invalid_payload", "Invalid webhook payload.", 400) from exc
        if not isinstance(payload, dict):
            raise BillingWebhookError("billing_webhook_invalid_payload", "Invalid webhook payload.", 400)
        return payload

    def _extract_event_id(self, payload: dict[str, object]) -> str:
        for key in ("event_id", "eventId", "notification_id", "notificationId", "id"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        raise BillingWebhookError("billing_webhook_missing_event_id", "Webhook event id is required.", 400)

    @staticmethod
    def _extract_customer_details(data: dict[str, object]) -> tuple[str | None, str | None]:
        customer_id = data.get("customer_id") or data.get("customerId")
        customer_email = data.get("customer_email") or data.get("customerEmail")
        customer = data.get("customer")
        if isinstance(customer, dict):
            customer_id = customer_id or customer.get("id")
            customer_email = customer_email or customer.get("email")
        return str(customer_id) if customer_id else None, str(customer_email) if customer_email else None

    @staticmethod
    def _extract_custom_data(data: dict[str, object]) -> dict[str, object]:
        custom_data = data.get("custom_data") or data.get("customData")
        return custom_data if isinstance(custom_data, dict) else {}

    @staticmethod
    def _extract_subscription_id(data: dict[str, object]) -> str | None:
        subscription_id = data.get("subscription_id") or data.get("subscriptionId")
        if isinstance(subscription_id, str) and subscription_id.strip():
            return subscription_id.strip()
        subscription = data.get("subscription")
        if isinstance(subscription, dict):
            sub_id = subscription.get("id")
            if isinstance(sub_id, str) and sub_id.strip():
                return sub_id.strip()
        return None

    @staticmethod
    def _extract_price_id(data: dict[str, object]) -> str | None:
        items = data.get("items")
        if isinstance(items, list) and items:
            item = items[0]
            if isinstance(item, dict):
                price_id = item.get("price_id") or item.get("priceId")
                if isinstance(price_id, str) and price_id.strip():
                    return price_id.strip()
                price = item.get("price")
                if isinstance(price, dict):
                    nested = price.get("id")
                    if isinstance(nested, str) and nested.strip():
                        return nested.strip()
        price_id = data.get("price_id") or data.get("priceId")
        return str(price_id).strip() if isinstance(price_id, str) and price_id.strip() else None

    @staticmethod
    def _extract_period_end(data: dict[str, object]) -> str | None:
        period = data.get("current_billing_period") or data.get("currentBillingPeriod")
        if isinstance(period, dict):
            end = period.get("ends_at") or period.get("endsAt")
            if isinstance(end, str) and end.strip():
                return end.strip()
        for key in ("next_billed_at", "nextBilledAt"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _extract_occurred_at(payload: dict[str, object], data: dict[str, object]) -> str | None:
        for source in (payload, data):
            for key in ("occurred_at", "occurredAt", "updated_at", "updatedAt", "created_at", "createdAt"):
                value = source.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return None

    @staticmethod
    def _normalize_timestamp(value: str | None) -> str | None:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None
        return parsed.isoformat().replace("+00:00", "Z")

    @staticmethod
    def _entitlement_status(event_type: str, subscription_status: str | None) -> str:
        if event_type in PADDLE_CANCEL_EVENTS:
            return "canceled"
        normalized = (subscription_status or "").strip().lower()
        if normalized in PADDLE_ACTIVE_STATUSES:
            return "active"
        if normalized in PADDLE_GRACE_STATUSES:
            return "grace_period"
        if normalized in {"canceled", "cancelled"}:
            return "canceled"
        return "expired"

    async def _resolve_user_id(self, *, user_id: str | None, customer_id: str | None, subscription_id: str | None) -> str | None:
        if user_id:
            return user_id
        if subscription_id:
            subscription = await self.repository.fetch_subscription_by_provider_subscription_id(subscription_id)
            if subscription and isinstance(subscription.get("user_id"), str):
                return subscription["user_id"]
        if customer_id:
            customer = await self.repository.fetch_customer_by_provider_customer_id(customer_id)
            if customer and isinstance(customer.get("user_id"), str):
                return customer["user_id"]
        return None

    async def handle_paddle_webhook(self, request: Request, raw_body: bytes, signature_header: str | None) -> dict[str, object]:
        self._verify_signature(raw_body, signature_header)
        payload = self._payload_json(raw_body)
        event_id = self._extract_event_id(payload)
        event_type = str(payload.get("event_type") or payload.get("eventType") or "").strip()
        data = payload.get("data")
        if not isinstance(data, dict):
            raise BillingWebhookError("billing_webhook_invalid_payload", "Webhook payload data is invalid.", 400)
        occurred_at = self._normalize_timestamp(self._extract_occurred_at(payload, data))
        event_record, created = await self.repository.create_webhook_event(
            event_id=event_id,
            event_type=event_type or "unknown",
            occurred_at=occurred_at,
            payload=payload,
        )
        if event_record and not created and event_record.get("processed_at"):
            return serialize_ok_envelope({"status": "deduped", "event_id": event_id})

        try:
            if event_type not in PADDLE_SUBSCRIPTION_EVENTS:
                logger.info("billing.webhook.ignored", extra={"event_type": event_type, "event_id": event_id})
                if event_record and event_record.get("id"):
                    await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
                return serialize_ok_envelope({"status": "ignored", "reason": "unsupported_event", "event_id": event_id})

            custom_data = self._extract_custom_data(data)
            customer_id, _customer_email = self._extract_customer_details(data)
            subscription_id = self._extract_subscription_id(data)
            user_id = await self._resolve_user_id(
                user_id=str(custom_data.get("user_id")).strip() if custom_data.get("user_id") else None,
                customer_id=customer_id,
                subscription_id=subscription_id,
            )
            if not user_id:
                if event_record and event_record.get("id"):
                    await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
                return serialize_ok_envelope({"status": "ignored", "reason": "missing_user_id", "event_id": event_id})

            existing_subscription = None
            if subscription_id:
                existing_subscription = await self.repository.fetch_subscription_by_provider_subscription_id(subscription_id)
                existing_payload = existing_subscription.get("payload") if isinstance(existing_subscription, dict) else {}
                if isinstance(existing_payload, dict):
                    current_event_time = self._normalize_timestamp(str(existing_payload.get("webhook_occurred_at") or ""))
                    if current_event_time and occurred_at and occurred_at < current_event_time:
                        if event_record and event_record.get("id"):
                            await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
                        return serialize_ok_envelope({"status": "ignored", "reason": "stale_event", "event_id": event_id})

            if customer_id:
                await self.repository.upsert_billing_customer(user_id=user_id, provider_customer_id=customer_id)

            subscription_status = str(data.get("status") or "").strip().lower() or None
            entitlement_status = self._entitlement_status(event_type, subscription_status)
            price_id = self._extract_price_id(data)
            tier = PRICE_ID_TO_TIER.get(price_id) or (existing_subscription.get("tier") if isinstance(existing_subscription, dict) else None)
            period_end = self._normalize_timestamp(self._extract_period_end(data))
            cancel_at_period_end = bool(data.get("cancel_at_period_end") or data.get("scheduled_change"))
            if event_type in PADDLE_CANCEL_EVENTS:
                cancel_at_period_end = False

            if subscription_id and tier in {"standard", "pro"}:
                await self.repository.upsert_billing_subscription(
                    user_id=user_id,
                    provider_subscription_id=subscription_id,
                    provider_price_id=price_id,
                    tier=tier,
                    status=subscription_status or entitlement_status,
                    current_period_end=period_end,
                    cancel_at_period_end=cancel_at_period_end,
                    payload={
                        "webhook_event_id": event_id,
                        "webhook_event_type": event_type,
                        "webhook_occurred_at": occurred_at,
                        "subscription_status": subscription_status,
                    },
                )

            if event_type in PADDLE_CANCEL_EVENTS:
                entitlement_tier = "free"
                paid_until = None
                auto_renew = False
            else:
                if tier not in {"standard", "pro"}:
                    if event_record and event_record.get("id"):
                        await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
                    return serialize_ok_envelope({"status": "ignored", "reason": "unknown_tier", "event_id": event_id})
                entitlement_tier = tier if entitlement_status in {"active", "grace_period"} else "free"
                paid_until = period_end if entitlement_status in {"active", "grace_period"} else None
                auto_renew = entitlement_status in {"active", "grace_period"} and not cancel_at_period_end

            await self.repository.update_entitlement(
                user_id=user_id,
                tier=entitlement_tier,
                status=entitlement_status,
                paid_until=paid_until,
                auto_renew=auto_renew,
            )
            if event_record and event_record.get("id"):
                await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
            return serialize_ok_envelope(
                {
                    "status": "processed",
                    "event_id": event_id,
                    "user_id": user_id,
                    "entitlement": {
                        "tier": entitlement_tier,
                        "status": entitlement_status,
                        "paid_until": paid_until,
                        "auto_renew": auto_renew,
                    },
                }
            )
        except Exception as exc:
            if event_record and event_record.get("id"):
                await self.repository.mark_webhook_event_failed(record_id=str(event_record["id"]), last_error=str(exc))
            raise
