from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from typing import Awaitable, Callable, Iterable, TypeVar

import httpx

T = TypeVar("T")

DEFAULT_TIMEOUT = httpx.Timeout(connect=3.0, read=6.0, write=3.0, pool=6.0)


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_s: float = 0.2
    max_delay_s: float = 1.0
    jitter_s: float = 0.2


TRANSIENT_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}


def _compute_backoff(attempt: int, policy: RetryPolicy) -> float:
    delay = min(policy.max_delay_s, policy.base_delay_s * (2 ** (attempt - 1)))
    return max(0.0, delay + random.uniform(0.0, policy.jitter_s))


async def call_with_retries(
    call: Callable[[], Awaitable[T]],
    *,
    retry_policy: RetryPolicy = RetryPolicy(),
    retry_on: tuple[type[BaseException], ...] = (httpx.TimeoutException, httpx.TransportError),
    retry_statuses: Iterable[int] = TRANSIENT_HTTP_STATUS,
) -> T:
    last_exc: BaseException | None = None
    retry_statuses = set(retry_statuses)

    for attempt in range(1, retry_policy.max_attempts + 1):
        try:
            result = await call()
            status_code = getattr(result, "status_code", None)
            if (
                isinstance(status_code, int)
                and status_code in retry_statuses
                and attempt < retry_policy.max_attempts
            ):
                await asyncio.sleep(_compute_backoff(attempt, retry_policy))
                continue
            return result
        except retry_on as exc:
            last_exc = exc
            if attempt >= retry_policy.max_attempts:
                raise
            await asyncio.sleep(_compute_backoff(attempt, retry_policy))

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("retry execution failed")


async def call_blocking_with_timeout(
    fn: Callable[[], T],
    *,
    timeout_s: float,
) -> T:
    return await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_s)
