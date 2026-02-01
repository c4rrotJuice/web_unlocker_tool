from __future__ import annotations

import asyncio
import heapq
import itertools
from contextlib import asynccontextmanager
from typing import AsyncIterator


class PriorityLimiter:
    def __init__(self, max_concurrency: int) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be >= 1")
        self._max_concurrency = max_concurrency
        self._current = 0
        self._waiters: list[tuple[int, int, asyncio.Future[bool]]] = []
        self._order = itertools.count()
        self._lock = asyncio.Lock()

    async def acquire(self, priority: int) -> None:
        async with self._lock:
            if self._current < self._max_concurrency and not self._waiters:
                self._current += 1
                return
            loop = asyncio.get_running_loop()
            future: asyncio.Future[bool] = loop.create_future()
            heapq.heappush(self._waiters, (priority, next(self._order), future))
        await future

    async def release(self) -> None:
        async with self._lock:
            self._current = max(self._current - 1, 0)
            while self._waiters and self._current < self._max_concurrency:
                _, _, future = heapq.heappop(self._waiters)
                if future.cancelled():
                    continue
                self._current += 1
                future.set_result(True)
                return

    @asynccontextmanager
    async def limit(self, priority: int) -> AsyncIterator[None]:
        await self.acquire(priority)
        try:
            yield
        finally:
            await self.release()
