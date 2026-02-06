import pytest

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
        self.evicted_hosts: list[str] = []

    def get_session(self, _hostname):
        return _FakeScraper(self._response), {"User-Agent": "Mozilla/5.0"}

    def evict(self, hostname):
        self.evicted_hosts.append(hostname)


@pytest.mark.parametrize(
    "status,headers,html,expected_confidence,expected_blocked",
    [
        (
            200,
            {"Server": "LiteSpeed"},
            "<html><head><title>WordPress</title></head><body>normal page</body></html>",
            "none",
            False,
        ),
        (
            403,
            {"Server": "cloudflare", "CF-RAY": "90f2b2aa1234abcd-DFW"},
            "<html><body>Sorry, you have been blocked</body></html>",
            "high",
            True,
        ),
        (
            200,
            {"Server": "cloudflare"},
            "<html><body>Just a moment... /cdn-cgi/challenge-platform</body></html>",
            "high",
            True,
        ),
    ],
)
def test_classify_blocked_response_confidence(status, headers, html, expected_confidence, expected_blocked):
    result = unprotector.classify_blocked_response(
        status=status,
        headers=headers,
        html=html,
        hostname="example.com",
    )

    assert result["confidence"] == expected_confidence
    assert result["is_blocked"] is expected_blocked


def test_classify_choneize_like_response_is_not_blocked():
    html = """
    <html><head><title>Choneize</title></head>
    <body><h1>Welcome to our blog</h1><p>This is normal content.</p></body></html>
    """
    result = unprotector.classify_blocked_response(
        status=200,
        headers={
            "Server": "LiteSpeed",
            "Content-Type": "text/html; charset=UTF-8",
            "X-Powered-By": "PHP/8.2",
        },
        html=html,
        hostname="choneize.com",
    )

    assert result["provider"] == "litespeed"
    assert result["is_blocked"] is False
    assert result["confidence"] in {"none", "low"}


def test_fetch_cloudscraper_does_not_evict_session_for_choneize_like_html(monkeypatch):
    fake_response = _FakeCloudscraperResponse(
        text="<html><body><h1>Normal WordPress content</h1></body></html>",
        status_code=200,
        headers={"Server": "LiteSpeed", "Content-Type": "text/html; charset=utf-8"},
        url="https://choneize.com/",
    )
    fake_pool = _FakePool(fake_response)

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    async def _safe_ssrf(_url):
        return False

    monkeypatch.setattr(unprotector, "_cloudscraper_session_pool", fake_pool)
    monkeypatch.setattr(unprotector, "is_ssrf_risk", _safe_ssrf)

    import asyncio

    result = asyncio.run(unprotector.fetch_and_clean_page(
        url="https://choneize.com/",
        user_ip="8.8.8.8",
        http_session=None,
        redis_get=_redis_get,
        redis_set=_redis_set,
        unlock=False,
        use_cloudscraper=True,
    ))

    assert "Verification Required" not in result
    assert fake_pool.evicted_hosts == []
