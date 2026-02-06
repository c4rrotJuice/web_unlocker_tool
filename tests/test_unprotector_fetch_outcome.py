import asyncio

from app.services import unprotector


class _FakeCloudscraperResponse:
    def __init__(self, text: str, status_code: int, headers: dict[str, str], url: str):
        self.status_code = status_code
        self.headers = headers
        self.content = text.encode("utf-8")
        self.encoding = "utf-8"
        self.url = url


class _FakeScraper:
    def __init__(self, response: _FakeCloudscraperResponse):
        self._response = response

    def get(self, _url, headers=None, timeout=None):
        return self._response


class _FakePool:
    def __init__(self, response: _FakeCloudscraperResponse):
        self._response = response

    def get_session(self, _hostname):
        return _FakeScraper(self._response), {"User-Agent": "Mozilla/5.0"}

    def evict(self, _hostname):
        return None


def test_fetch_outcome_cloudflare_403(monkeypatch):
    response = _FakeCloudscraperResponse(
        text="<html><body>Sorry, you have been blocked</body></html>",
        status_code=403,
        headers={"Server": "cloudflare", "CF-RAY": "90f2b2aa1234abcd-DFW", "Content-Type": "text/html"},
        url="https://www.monitor.co.ug/",
    )

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    async def _safe_ssrf(_url):
        return False

    monkeypatch.setattr(unprotector, "_cloudscraper_session_pool", _FakePool(response))
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)

    outcome = asyncio.run(
        unprotector.fetch_and_clean_page(
            url="https://www.monitor.co.ug/",
            user_ip="8.8.8.8",
            http_session=None,
            redis_get=_redis_get,
            redis_set=_redis_set,
            unlock=False,
            use_cloudscraper=True,
        )
    )

    assert outcome.success is False
    assert outcome.outcome_reason == "blocked_by_cloudflare"
    assert outcome.http_status == 403
    assert outcome.ray_id == "90f2b2aa1234abcd-DFW"


def test_fetch_outcome_low_confidence_is_non_fatal(monkeypatch):
    response = _FakeCloudscraperResponse(
        text="<html><body>Please enable javascript and cookies</body></html>",
        status_code=200,
        headers={"Server": "cloudflare", "Content-Type": "text/html"},
        url="https://example.com/",
    )

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    async def _safe_ssrf(_url):
        return False

    monkeypatch.setattr(unprotector, "_cloudscraper_session_pool", _FakePool(response))
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)

    outcome = asyncio.run(
        unprotector.fetch_and_clean_page(
            url="https://example.com/",
            user_ip="8.8.8.8",
            http_session=None,
            redis_get=_redis_get,
            redis_set=_redis_set,
            unlock=False,
            use_cloudscraper=True,
        )
    )

    assert outcome.success is True
    assert outcome.confidence == "low"
    assert outcome.outcome_reason == "suspected_block_low_conf"

def test_fetch_outcome_ok(monkeypatch):
    response = _FakeCloudscraperResponse(
        text="<html><body>normal page</body></html>",
        status_code=200,
        headers={"Server": "LiteSpeed", "Content-Type": "text/html"},
        url="https://normal.example/",
    )

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    async def _safe_ssrf(_url):
        return False

    monkeypatch.setattr(unprotector, "_cloudscraper_session_pool", _FakePool(response))
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)

    outcome = asyncio.run(
        unprotector.fetch_and_clean_page(
            url="https://normal.example/",
            user_ip="8.8.8.8",
            http_session=None,
            redis_get=_redis_get,
            redis_set=_redis_set,
            unlock=False,
            use_cloudscraper=True,
        )
    )

    assert outcome.success is True
    assert outcome.outcome_reason == "ok"
