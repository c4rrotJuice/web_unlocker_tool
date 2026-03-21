from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging

from fastapi import Request

from app.core.account_state import BillingCustomer, BillingSubscription
from app.core.auth import RequestAuthContext
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.serialization import (
    serialize_billing_customer,
    serialize_billing_subscription,
    serialize_module_status,
    serialize_ok_envelope,
)
from app.modules.billing.repo import BillingRepository
from app.routes.http import http_client


logger = logging.getLogger(__name__)

SUPPORTED_TIERS = {"standard", "pro"}
SUPPORTED_INTERVALS = {"monthly", "yearly"}
LEGACY_PRICE_ID_TO_TIER = {
    "pri_01kf77v5j5j1b0fkwb95p0wxew": "standard",
    "pri_01kf77xyfjdh0rr66caz2dnye7": "standard",
    "pri_01kf781jrxcwtg70bxky3316fr": "pro",
    "pri_01kf7839fptpnr6wtgwcnkwe1r": "pro",
}
PADDLE_ACTIVE_STATUSES = {"active", "trialing"}
PADDLE_GRACE_STATUSES = {"past_due"}
PADDLE_LIVE_API_BASE_URL = "https://api.paddle.com"
PADDLE_SANDBOX_API_BASE_URL = "https://sandbox-api.paddle.com"
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
PADDLE_TRANSACTION_FINALIZATION_EVENTS = {
    "transaction.completed",
    "transaction.paid",
}
PADDLE_WEBHOOK_EVENTS = PADDLE_SUBSCRIPTION_EVENTS | PADDLE_TRANSACTION_FINALIZATION_EVENTS


class BillingWebhookError(AppError):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(code, message, status_code)


class BillingCheckoutError(AppError):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        *,
        extra: dict[str, object] | None = None,
    ) -> None:
        super().__init__(code, message, status_code, extra=extra or {})


def _as_str(value: object | None) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


class BillingService:
    def __init__(self, *, repository: BillingRepository):
        self.repository = repository
        self.settings = get_settings()

    def _plan_catalog(self) -> dict[tuple[str, str], str | None]:
        return {
            ("standard", "monthly"): self.settings.paddle_standard_monthly_price_id,
            ("standard", "yearly"): self.settings.paddle_standard_yearly_price_id,
            ("pro", "monthly"): self.settings.paddle_pro_monthly_price_id,
            ("pro", "yearly"): self.settings.paddle_pro_yearly_price_id,
        }

    def _legacy_plan_catalog(self) -> dict[str, tuple[str, str]]:
        return {
            "pri_01kf77v5j5j1b0fkwb95p0wxew": ("standard", "monthly"),
            "pri_01kf77xyfjdh0rr66caz2dnye7": ("standard", "yearly"),
            "pri_01kf781jrxcwtg70bxky3316fr": ("pro", "monthly"),
            "pri_01kf7839fptpnr6wtgwcnkwe1r": ("pro", "yearly"),
        }

    def _resolve_price_id(self, tier: str, interval: str) -> str | None:
        return self._plan_catalog().get((tier, interval))

    def _resolve_tier_interval_from_price_id(self, price_id: str | None) -> tuple[str | None, str | None]:
        if not price_id:
            return None, None
        for (tier, interval), configured_price_id in self._plan_catalog().items():
            if configured_price_id and configured_price_id == price_id:
                return tier, interval
        legacy = self._legacy_plan_catalog().get(price_id)
        if legacy:
            return legacy
        tier = LEGACY_PRICE_ID_TO_TIER.get(price_id)
        if tier:
            return tier, "monthly"
        return None, None

    def _missing_checkout_configuration(self) -> list[str]:
        missing: list[str] = []
        if not self.settings.paddle_api_key:
            missing.append("PADDLE_API_KEY")
        for env_name, price_id in (
            ("PADDLE_STANDARD_MONTHLY_PRICE_ID", self.settings.paddle_standard_monthly_price_id),
            ("PADDLE_STANDARD_YEARLY_PRICE_ID", self.settings.paddle_standard_yearly_price_id),
            ("PADDLE_PRO_MONTHLY_PRICE_ID", self.settings.paddle_pro_monthly_price_id),
            ("PADDLE_PRO_YEARLY_PRICE_ID", self.settings.paddle_pro_yearly_price_id),
        ):
            if not price_id:
                missing.append(env_name)
        return missing

    @staticmethod
    def _paddle_environment_from_base_url(base_url: str) -> str | None:
        normalized = base_url.rstrip("/")
        if normalized == PADDLE_LIVE_API_BASE_URL:
            return "live"
        if normalized == PADDLE_SANDBOX_API_BASE_URL:
            return "sandbox"
        return None

    @staticmethod
    def _paddle_environment_from_api_key(api_key: str | None) -> str | None:
        key = (api_key or "").strip()
        if not key:
            return None
        if key.startswith("pdl_sdbx_") or "_sdbx_" in key:
            return "sandbox"
        if key.startswith("pdl_live_") or "_live_" in key:
            return "live"
        return None

    def _validate_checkout_environment(self) -> tuple[str, str | None]:
        base_url = self.settings.paddle_api_base_url.rstrip("/")
        paddle_environment = self._paddle_environment_from_base_url(base_url)
        if paddle_environment is None:
            raise BillingCheckoutError(
                "billing_checkout_config_invalid",
                "PADDLE_API_BASE_URL must target Paddle live or sandbox.",
                500,
                extra={"paddle_api_base_url": base_url},
            )

        api_key_environment = self._paddle_environment_from_api_key(self.settings.paddle_api_key)
        if api_key_environment and api_key_environment != paddle_environment:
            raise BillingCheckoutError(
                "billing_checkout_config_mismatch",
                "Paddle API key environment does not match the configured Paddle API base URL.",
                500,
                extra={
                    "paddle_api_base_url": base_url,
                    "paddle_environment": paddle_environment,
                    "paddle_api_key_environment": api_key_environment,
                },
            )
        return base_url, paddle_environment

    @staticmethod
    def _extract_paddle_error(response) -> tuple[str | None, str | None, str | None]:
        error_type = None
        error_code = None
        detail = None
        try:
            body = response.json()
        except Exception:
            body = None
        if isinstance(body, dict):
            error_type = _as_str(body.get("type"))
            error_code = _as_str(body.get("code"))
            detail = _as_str(body.get("detail")) or _as_str(body.get("message"))
            if not detail and isinstance(body.get("error"), dict):
                nested_error = body.get("error")
                error_type = error_type or _as_str(nested_error.get("type"))
                error_code = error_code or _as_str(nested_error.get("code"))
                detail = _as_str(nested_error.get("detail")) or _as_str(nested_error.get("message"))
        if not detail:
            detail = response.text.strip() or None
        return error_type, error_code, detail

    def status(self) -> dict[str, object]:
        return serialize_module_status(
            module="billing",
            contract=str(self.settings.migration_pack_dir),
            notes=[
                "Billing reads come from billing_customers and billing_subscriptions only.",
                "Billing webhook mutation is limited to canonical billing and entitlement tables.",
                "Checkout initiation is server-authoritative through Paddle transactions.",
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

    async def create_checkout(self, auth_context: RequestAuthContext, tier: str, interval: str) -> dict[str, object]:
        if tier not in SUPPORTED_TIERS:
            raise BillingCheckoutError("billing_checkout_invalid_tier", "Unsupported billing tier.", 422)
        if interval not in SUPPORTED_INTERVALS:
            raise BillingCheckoutError("billing_checkout_invalid_interval", "Unsupported billing interval.", 422)

        missing = self._missing_checkout_configuration()
        if missing:
            raise BillingCheckoutError(
                "billing_checkout_config_missing",
                f"Missing billing configuration: {', '.join(missing)}",
                500,
                extra={"missing": missing},
            )
        paddle_base_url, paddle_environment = self._validate_checkout_environment()

        price_id = self._resolve_price_id(tier, interval)
        if not price_id:
            raise BillingCheckoutError(
                "billing_checkout_price_missing",
                f"No Paddle price id configured for {tier}/{interval}.",
                500,
                extra={"tier": tier, "interval": interval},
            )

        response = await http_client.post(
            f"{paddle_base_url}/transactions",
            json={
                "items": [
                    {
                        "price_id": price_id,
                        "quantity": 1,
                    }
                ],
                "collection_mode": "automatic",
                "custom_data": {
                    "user_id": auth_context.user_id,
                    "tier": tier,
                    "interval": interval,
                    "email": auth_context.email,
                },
            },
            headers={
                "Authorization": f"Bearer {self.settings.paddle_api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        if response.status_code >= 400:
            error_type, error_code, detail = self._extract_paddle_error(response)
            logger.warning(
                "billing.checkout.paddle_request_failed",
                extra={
                    "provider": "paddle",
                    "paddle_environment": paddle_environment,
                    "paddle_api_base_url": paddle_base_url,
                    "upstream_status": response.status_code,
                    "upstream_error_type": error_type,
                    "upstream_error_code": error_code,
                    "upstream_error_detail": detail,
                    "price_id": price_id,
                    "tier": tier,
                    "interval": interval,
                },
            )
            if response.status_code == 403:
                raise BillingCheckoutError(
                    "billing_checkout_provider_forbidden",
                    "Paddle rejected the checkout request.",
                    502,
                    extra={
                        "provider": "paddle",
                        "upstream_status": response.status_code,
                        "upstream_error_type": error_type,
                        "upstream_error_code": error_code,
                        "upstream_error_detail": detail,
                        "paddle_environment": paddle_environment,
                    },
                )
            raise BillingCheckoutError(
                "billing_checkout_provider_error",
                "Paddle checkout creation failed.",
                502,
                extra={
                    "provider": "paddle",
                    "upstream_status": response.status_code,
                    "upstream_error_type": error_type,
                    "upstream_error_code": error_code,
                    "upstream_error_detail": detail,
                    "paddle_environment": paddle_environment,
                },
            )

        try:
            payload = response.json()
        except Exception as exc:
            raise BillingCheckoutError("billing_checkout_provider_error", "Paddle checkout response was invalid.", 502) from exc

        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise BillingCheckoutError("billing_checkout_provider_error", "Paddle checkout response was invalid.", 502)

        transaction_id = _as_str(data.get("id"))
        if not transaction_id:
            raise BillingCheckoutError("billing_checkout_provider_error", "Paddle checkout response was missing a transaction id.", 502)

        checkout_url = None
        checkout = data.get("checkout")
        if isinstance(checkout, dict):
            checkout_url = _as_str(checkout.get("url"))

        return serialize_ok_envelope(
            {
                "provider": "paddle",
                "tier": tier,
                "interval": interval,
                "transaction_id": transaction_id,
                "checkout_url": checkout_url,
            }
        )

    def _verify_signature(self, raw_body: bytes, signature_header: str | None) -> None:
        secret = self.settings.paddle_webhook_secret
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
        if event_type in PADDLE_TRANSACTION_FINALIZATION_EVENTS:
            return "active"
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
        request_id = getattr(request.state, "request_id", None)
        logger.info(
            "billing.webhook.received",
            extra={"event_id": event_id, "event_type": event_type or "unknown", "request_id": request_id},
        )
        event_record, created = await self.repository.create_webhook_event(
            event_id=event_id,
            event_type=event_type or "unknown",
            occurred_at=occurred_at,
            payload=payload,
        )
        if event_record and not created and event_record.get("processed_at"):
            return serialize_ok_envelope({"status": "deduped", "event_id": event_id})

        try:
            if event_type not in PADDLE_WEBHOOK_EVENTS:
                logger.info(
                    "billing.webhook.ignored",
                    extra={"event_type": event_type, "event_id": event_id, "request_id": request_id},
                )
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
                raise BillingWebhookError(
                    "billing_webhook_missing_user_reference",
                    "Webhook payload did not include a resolvable user reference.",
                    422,
                )
            logger.info(
                "billing.webhook.user_resolved",
                extra={"event_id": event_id, "event_type": event_type or "unknown", "user_id": user_id, "request_id": request_id},
            )

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
                logger.info(
                    "billing.webhook.upsert_customer",
                    extra={
                        "event_id": event_id,
                        "event_type": event_type or "unknown",
                        "user_id": user_id,
                        "provider_customer_id": customer_id,
                        "request_id": request_id,
                    },
                )
                await self.repository.upsert_billing_customer(user_id=user_id, provider_customer_id=customer_id)

            subscription_status = str(data.get("status") or "").strip().lower() or None
            entitlement_status = self._entitlement_status(event_type, subscription_status)
            price_id = self._extract_price_id(data)
            tier, _interval = self._resolve_tier_interval_from_price_id(price_id)
            if tier is None:
                custom_tier = custom_data.get("tier")
                if isinstance(custom_tier, str) and custom_tier in SUPPORTED_TIERS:
                    tier = custom_tier
            if tier is None:
                tier = existing_subscription.get("tier") if isinstance(existing_subscription, dict) else None
            if tier not in {"standard", "pro"} and event_type not in PADDLE_CANCEL_EVENTS:
                raise BillingWebhookError(
                    "billing_webhook_unknown_tier",
                    "Webhook payload did not resolve to a supported billing tier.",
                    422,
                )
            period_end = self._normalize_timestamp(self._extract_period_end(data))
            cancel_at_period_end = bool(data.get("cancel_at_period_end") or data.get("scheduled_change"))
            if event_type in PADDLE_CANCEL_EVENTS:
                cancel_at_period_end = False

            if subscription_id and tier in {"standard", "pro"}:
                logger.info(
                    "billing.webhook.upsert_subscription",
                    extra={
                        "event_id": event_id,
                        "event_type": event_type or "unknown",
                        "user_id": user_id,
                        "provider_subscription_id": subscription_id,
                        "provider_price_id": price_id,
                        "tier": tier,
                        "request_id": request_id,
                    },
                )
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
                entitlement_tier = tier if entitlement_status in {"active", "grace_period"} else "free"
                paid_until = period_end if entitlement_status in {"active", "grace_period"} else None
                auto_renew = entitlement_status in {"active", "grace_period"} and not cancel_at_period_end

            logger.info(
                "billing.webhook.update_entitlement",
                extra={
                    "event_id": event_id,
                    "event_type": event_type or "unknown",
                    "user_id": user_id,
                    "tier": entitlement_tier,
                    "status": entitlement_status,
                    "paid_until": paid_until,
                    "auto_renew": auto_renew,
                    "request_id": request_id,
                },
            )
            await self.repository.update_entitlement(
                user_id=user_id,
                tier=entitlement_tier,
                status=entitlement_status,
                paid_until=paid_until,
                auto_renew=auto_renew,
            )
            if event_record and event_record.get("id"):
                await self.repository.mark_webhook_event_processed(record_id=str(event_record["id"]))
            logger.info(
                "billing.webhook.processed",
                extra={
                    "event_id": event_id,
                    "event_type": event_type or "unknown",
                    "user_id": user_id,
                    "tier": entitlement_tier,
                    "status": entitlement_status,
                    "request_id": request_id,
                },
            )
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
            logger.exception(
                "billing.webhook.failed",
                extra={"event_id": event_id, "event_type": event_type or "unknown", "request_id": request_id},
            )
            raise
