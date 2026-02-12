import asyncio

from app.services import unprotector
from app.services.metrics import MetricsStore
from app.services.priority_limiter import PriorityLimiter


class _FakeResponse:
    def __init__(self, body: str, headers: dict[str, str] | None = None, status_code: int = 200):
        self.content = body.encode("utf-8")
        self.headers = headers or {"Content-Type": "text/html; charset=utf-8"}
        self.status_code = status_code
        self.encoding = "utf-8"
        self.url = "https://example.com/"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("http error")


class _FakeHttpClient:
    def __init__(self, response: _FakeResponse):
        self._response = response

    async def get(self, _url, headers=None, timeout=None):
        return self._response


async def _safe_ssrf(_url):
    return False


def test_fetch_and_clean_page_records_pipeline_stage_metrics(monkeypatch):
    store = MetricsStore()
    monkeypatch.setattr(unprotector, "metrics", store)
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)

    html_doc = "<html><head><title>x</title></head><body><h1>Hello</h1></body></html>"
    fake_http = _FakeHttpClient(_FakeResponse(html_doc))

    async def _redis_get(_key):
        return None

    writes = []

    async def _redis_set(key, value, ttl_seconds=None):
        writes.append((key, ttl_seconds, value))

    result = asyncio.run(
        unprotector.fetch_and_clean_page(
            url="https://example.com/",
            user_ip="8.8.8.8",
            http_session=fake_http,
            redis_get=_redis_get,
            redis_set=_redis_set,
            unlock=True,
            use_cloudscraper=False,
        )
    )

    assert "This page has been unlocked" in result
    assert writes
    output = store.render_prometheus()
    assert "unlock_pipeline_stage_ssrf_check_milliseconds_count" in output
    assert "unlock_pipeline_stage_fetch_milliseconds_count" in output
    assert "unlock_pipeline_stage_parse_clean_rewrite_milliseconds_count" in output
    assert "unlock_pipeline_stage_cache_set_milliseconds_count" in output


def test_retry_ceiling_and_autotune_reduce_on_slow_conditions(monkeypatch):
    store = MetricsStore()
    monkeypatch.setattr(unprotector, "metrics", store)
    monkeypatch.setattr(unprotector, "FETCH_MAX_RETRIES", 4)
    monkeypatch.setattr(unprotector, "DYNAMIC_FETCH_RETRY_FLOOR", 1)
    monkeypatch.setattr(unprotector, "SLOW_FETCH_THRESHOLD_MS", 100)
    monkeypatch.setattr(unprotector, "ENABLE_FETCH_AUTOTUNE", True)
    monkeypatch.setattr(unprotector, "FETCH_AUTOTUNE_EVERY_N_REQUESTS", 1)
    monkeypatch.setattr(unprotector, "FETCH_CONCURRENCY_MIN", 2)
    monkeypatch.setattr(unprotector, "FETCH_CONCURRENCY_MAX", 10)

    store.observe_ms("unlock_pipeline.stage.fetch", 180)
    store.observe_ms("unlock_pipeline.queue_wait", 1600)
    store.inc("unlock_pipeline.request_count", 10)
    store.inc("unlock_pipeline.retry_count", 6)

    assert unprotector._effective_retry_ceiling() == 1

    limiter = PriorityLimiter(5)
    asyncio.run(unprotector._maybe_autotune_fetch_controls(limiter))
    assert limiter.max_concurrency == 4


def test_large_page_returns_clear_fallback_message(monkeypatch):
    store = MetricsStore()
    monkeypatch.setattr(unprotector, "metrics", store)
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)
    monkeypatch.setattr(unprotector, "MAX_PROCESSABLE_PAGE_BYTES", 20)

    fake_http = _FakeHttpClient(
        _FakeResponse(
            "<html><body>body</body></html>",
            headers={
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": "100",
            },
        )
    )

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    result = asyncio.run(
        unprotector.fetch_and_clean_page(
            url="https://example.com/",
            user_ip="8.8.8.8",
            http_session=fake_http,
            redis_get=_redis_get,
            redis_set=_redis_set,
            unlock=True,
            use_cloudscraper=False,
        )
    )

    assert "too large to unlock safely" in result
    assert store.counter("unlock_pipeline.page_too_large_count") == 1
