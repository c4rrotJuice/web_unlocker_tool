from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.routes.http import http_client
from app.services.metrics import record_dependency_call_async
from app.services.resilience import DEFAULT_TIMEOUT


class SupabaseRestRepository:
    def __init__(self, *, base_url: str | None, service_role_key: str | None):
        self.base_url = (base_url or "").rstrip("/")
        self.service_role_key = service_role_key

    def _resource_url(self, resource: str) -> str:
        if not self.base_url:
            raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured.")
        resource_name = resource.lstrip("/")
        return f"{self.base_url}/rest/v1/{resource_name}"

    def headers(self, *, prefer: str | None = None, include_content_type: bool = True) -> dict[str, str]:
        if not self.service_role_key:
            raise HTTPException(status_code=500, detail="Supabase service role key missing.")

        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
        }
        if include_content_type:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def request(
        self,
        method: str,
        *,
        resource: str,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ):
        method_lower = method.lower()
        client_method = getattr(http_client, method_lower, None)
        url = self._resource_url(resource)

        request_kwargs: dict[str, Any] = {
            "params": params,
            "headers": headers or self.headers(),
            "timeout": DEFAULT_TIMEOUT,
        }
        if json is not None:
            request_kwargs["json"] = json

        async def _invoke():
            if client_method is not None:
                return await client_method(url, **request_kwargs)
            return await http_client.request(method.upper(), url, **request_kwargs)

        try:
            return await record_dependency_call_async("supabase", _invoke)
        except TypeError:
            request_kwargs.pop("timeout", None)
            return await record_dependency_call_async("supabase", _invoke)

    async def get(self, resource: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None):
        return await self.request("GET", resource=resource, params=params, headers=headers)

    async def post(
        self,
        resource: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ):
        return await self.request("POST", resource=resource, params=params, json=json, headers=headers)

    async def patch(
        self,
        resource: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ):
        return await self.request("PATCH", resource=resource, params=params, json=json, headers=headers)

    async def delete(
        self,
        resource: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ):
        return await self.request("DELETE", resource=resource, params=params, headers=headers)


async def expect_ok(response, *, detail: str, allowed: set[int] | tuple[int, ...] = (200,)):
    if response.status_code not in set(allowed):
        raise HTTPException(status_code=500, detail=detail)
    return response
