from __future__ import annotations

from app.core.account_state import BillingCustomer, BillingSubscription
from app.core.config import get_settings
from app.core.serialization import (
    serialize_billing_customer,
    serialize_billing_subscription,
    serialize_module_status,
    serialize_ok_envelope,
)
from app.modules.billing.repo import BillingRepository


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
                "Billing read models are isolated from entitlement mutation and webhook writes.",
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
