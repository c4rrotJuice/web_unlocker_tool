from __future__ import annotations

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
