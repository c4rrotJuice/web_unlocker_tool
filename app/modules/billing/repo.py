from __future__ import annotations

from datetime import datetime, timezone

from app.services.supabase_rest import SupabaseRestRepository, response_json


class BillingRepository:
    def __init__(self, *, supabase_repo: SupabaseRestRepository):
        self.supabase_repo = supabase_repo

    async def _fetch_single(self, resource: str, *, user_id: str, order: str | None = None) -> dict[str, object] | None:
        params = {"select": "*", "user_id": f"eq.{user_id}", "limit": "1"}
        if order:
            params["order"] = order
        response = await self.supabase_repo.get(
            resource,
            params=params,
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        if response.status_code != 200:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            item = payload[0]
            return item if isinstance(item, dict) else None
        return None

    async def fetch_customer(self, user_id: str) -> dict[str, object] | None:
        return await self._fetch_single("billing_customers", user_id=user_id)

    async def fetch_subscription(self, user_id: str) -> dict[str, object] | None:
        return await self._fetch_single("billing_subscriptions", user_id=user_id, order="created_at.desc")

    async def fetch_customer_by_provider_customer_id(self, provider_customer_id: str) -> dict[str, object] | None:
        response = await self.supabase_repo.get(
            "billing_customers",
            params={"select": "*", "provider_customer_id": f"eq.{provider_customer_id}", "limit": "1"},
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        if response.status_code != 200:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            return payload[0] if isinstance(payload[0], dict) else None
        return None

    async def fetch_subscription_by_provider_subscription_id(self, provider_subscription_id: str) -> dict[str, object] | None:
        response = await self.supabase_repo.get(
            "billing_subscriptions",
            params={"select": "*", "provider_subscription_id": f"eq.{provider_subscription_id}", "limit": "1"},
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        if response.status_code != 200:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            return payload[0] if isinstance(payload[0], dict) else None
        return None

    async def fetch_webhook_event(self, event_id: str) -> dict[str, object] | None:
        response = await self.supabase_repo.get(
            "billing_webhook_events",
            params={"select": "*", "event_id": f"eq.{event_id}", "limit": "1"},
            headers=self.supabase_repo.headers(include_content_type=False),
        )
        if response.status_code != 200:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            return payload[0] if isinstance(payload[0], dict) else None
        return None

    async def create_webhook_event(self, *, event_id: str, event_type: str, occurred_at: str | None, payload: dict[str, object]) -> tuple[dict[str, object] | None, bool]:
        response = await self.supabase_repo.post(
            "billing_webhook_events",
            json={
                "provider": "paddle",
                "event_id": event_id,
                "event_type": event_type,
                "occurred_at": occurred_at,
                "payload": payload,
            },
            headers=self.supabase_repo.headers(prefer="return=representation"),
        )
        if response.status_code in {200, 201}:
            rows = response_json(response)
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                return rows[0], True
        if response.status_code == 409:
            existing = await self.fetch_webhook_event(event_id)
            return existing, False
        return None, False

    async def mark_webhook_event_processed(self, *, record_id: str, last_error: str | None = None) -> None:
        patch = {
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "last_error": last_error,
        }
        await self.supabase_repo.patch(
            "billing_webhook_events",
            params={"id": f"eq.{record_id}"},
            json=patch,
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def mark_webhook_event_failed(self, *, record_id: str, last_error: str) -> None:
        await self.supabase_repo.patch(
            "billing_webhook_events",
            params={"id": f"eq.{record_id}"},
            json={"last_error": last_error},
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def upsert_billing_customer(self, *, user_id: str, provider_customer_id: str) -> None:
        existing = await self.fetch_customer(user_id)
        if existing:
            await self.supabase_repo.patch(
                "billing_customers",
                params={"user_id": f"eq.{user_id}"},
                json={"provider_customer_id": provider_customer_id},
                headers=self.supabase_repo.headers(prefer="return=minimal"),
            )
            return
        await self.supabase_repo.post(
            "billing_customers",
            json={
                "user_id": user_id,
                "provider": "paddle",
                "provider_customer_id": provider_customer_id,
            },
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def upsert_billing_subscription(
        self,
        *,
        user_id: str,
        provider_subscription_id: str,
        provider_price_id: str | None,
        tier: str,
        status: str,
        current_period_end: str | None,
        cancel_at_period_end: bool,
        payload: dict[str, object],
    ) -> None:
        existing = await self.fetch_subscription_by_provider_subscription_id(provider_subscription_id)
        body = {
            "user_id": user_id,
            "provider": "paddle",
            "provider_subscription_id": provider_subscription_id,
            "provider_price_id": provider_price_id,
            "tier": tier,
            "status": status,
            "current_period_end": current_period_end,
            "cancel_at_period_end": cancel_at_period_end,
            "payload": payload,
        }
        if existing:
            await self.supabase_repo.patch(
                "billing_subscriptions",
                params={"provider_subscription_id": f"eq.{provider_subscription_id}"},
                json=body,
                headers=self.supabase_repo.headers(prefer="return=minimal"),
            )
            return
        await self.supabase_repo.post(
            "billing_subscriptions",
            json=body,
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )

    async def update_entitlement(
        self,
        *,
        user_id: str,
        tier: str,
        status: str,
        paid_until: str | None,
        auto_renew: bool,
        source: str = "paddle",
    ) -> None:
        await self.supabase_repo.patch(
            "user_entitlements",
            params={"user_id": f"eq.{user_id}"},
            json={
                "tier": tier,
                "status": status,
                "paid_until": paid_until,
                "auto_renew": auto_renew,
                "source": source,
            },
            headers=self.supabase_repo.headers(prefer="return=minimal"),
        )
