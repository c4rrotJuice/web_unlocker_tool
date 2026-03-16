from __future__ import annotations

from app.services.supabase_rest import SupabaseRestRepository, response_json


class IdentityRepository:
    def __init__(
        self,
        *,
        user_supabase_repo: SupabaseRestRepository,
        bootstrap_supabase_repo: SupabaseRestRepository,
        anon_key: str | None,
    ):
        self.user_supabase_repo = user_supabase_repo
        self.bootstrap_supabase_repo = bootstrap_supabase_repo
        self.anon_key = anon_key

    def _user_headers(self, access_token: str, *, prefer: str | None = None, include_content_type: bool = True) -> dict[str, str]:
        headers = {
            "apikey": self.anon_key or "",
            "Authorization": f"Bearer {access_token}",
        }
        if include_content_type:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _fetch_single(self, resource: str, *, user_id: str, access_token: str, order: str | None = None) -> dict[str, object] | None:
        params = {"select": "*", "user_id": f"eq.{user_id}", "limit": "1"}
        if order:
            params["order"] = order
        response = await self.user_supabase_repo.get(
            resource,
            params=params,
            headers=self._user_headers(access_token, include_content_type=False),
        )
        if response.status_code != 200:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            item = payload[0]
            return item if isinstance(item, dict) else None
        return None

    async def _patch_single(
        self,
        resource: str,
        *,
        user_id: str,
        access_token: str,
        patch: dict[str, object],
    ) -> dict[str, object] | None:
        response = await self.user_supabase_repo.patch(
            resource,
            params={"user_id": f"eq.{user_id}", "select": "*"},
            json=patch,
            headers=self._user_headers(access_token, prefer="return=representation"),
        )
        if response.status_code not in {200, 204}:
            return None
        payload = response_json(response)
        if isinstance(payload, list) and payload:
            item = payload[0]
            return item if isinstance(item, dict) else None
        return None

    async def fetch_profile(self, user_id: str, access_token: str) -> dict[str, object] | None:
        return await self._fetch_single("user_profiles", user_id=user_id, access_token=access_token)

    async def fetch_preferences(self, user_id: str, access_token: str) -> dict[str, object] | None:
        return await self._fetch_single("user_preferences", user_id=user_id, access_token=access_token)

    async def fetch_entitlement(self, user_id: str, access_token: str) -> dict[str, object] | None:
        return await self._fetch_single("user_entitlements", user_id=user_id, access_token=access_token)

    async def update_profile(self, user_id: str, access_token: str, patch: dict[str, object]) -> dict[str, object] | None:
        return await self._patch_single("user_profiles", user_id=user_id, access_token=access_token, patch=patch)

    async def update_preferences(self, user_id: str, access_token: str, patch: dict[str, object]) -> dict[str, object] | None:
        return await self._patch_single("user_preferences", user_id=user_id, access_token=access_token, patch=patch)

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None) -> bool:
        response = await self.bootstrap_supabase_repo.rpc(
            "bootstrap_new_user",
            json={
                "p_user_id": user_id,
                "p_display_name": display_name,
                "p_use_case": use_case,
            },
            headers=self.bootstrap_supabase_repo.headers(),
        )
        return response.status_code in {200, 204}
