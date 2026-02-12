#app.routes.http
from __future__ import annotations

import httpx

from app.services.resilience import DEFAULT_TIMEOUT, RetryPolicy, call_with_retries


class ResilientAsyncClient(httpx.AsyncClient):
    def __init__(self, *args, retry_policy: RetryPolicy | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._retry_policy = retry_policy or RetryPolicy(max_attempts=3, base_delay_s=0.2, max_delay_s=1.0, jitter_s=0.25)

    async def request(self, method: str, url, *args, **kwargs):  # type: ignore[override]
        kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
        return await call_with_retries(
            lambda: super(ResilientAsyncClient, self).request(method, url, *args, **kwargs),
            retry_policy=self._retry_policy,
        )


http_client = ResilientAsyncClient(
    timeout=DEFAULT_TIMEOUT,
    limits=httpx.Limits(
        max_connections=20,
        max_keepalive_connections=10
    ),
    http2=True
)
