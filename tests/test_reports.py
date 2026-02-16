from types import SimpleNamespace

import pytest

from app.routes import dashboard


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, headers=None):
        self.status_code = status_code
        self._json_data = json_data or []
        self.headers = headers or {}

    def json(self):
        return self._json_data


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_monthly_report_returns_pdf(monkeypatch):
    async def fake_get(url, params=None, headers=None):
        if "user_milestones" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [], {"content-range": "0-0/5"})

    async def fake_post(url, headers=None, json=None):
        if "get_unlock_days" in url:
            return FakeResponse(200, [{"day": "2025-01-10"}])
        if "get_monthly_domain_counts" in url:
            return FakeResponse(200, [{"domain": "example.com", "unlocks": 3}])
        if "get_monthly_citation_breakdown" in url:
            return FakeResponse(200, [{"format": "mla", "citations": 2}])
        return FakeResponse(200, [])

    monkeypatch.setattr(dashboard, "http_client", SimpleNamespace(get=fake_get, post=fake_post))

    request = SimpleNamespace(state=SimpleNamespace(user_id="user-123", name="Ada Lovelace", account_type="pro"))
    response = await dashboard.get_monthly_report(request, month="2025-01")

    assert response.media_type == "application/pdf"
    assert "Research-Activity-Report_2025-01.pdf" in response.headers["Content-Disposition"]


@pytest.mark.anyio
async def test_monthly_report_allows_dev_tier(monkeypatch):
    async def fake_get(url, params=None, headers=None):
        if "user_milestones" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [], {"content-range": "0-0/3"})

    async def fake_post(url, headers=None, json=None):
        if "get_unlock_days" in url:
            return FakeResponse(200, [{"day": "2025-01-10"}])
        if "get_monthly_domain_counts" in url:
            return FakeResponse(200, [])
        if "get_monthly_citation_breakdown" in url:
            return FakeResponse(200, [])
        return FakeResponse(200, [])

    monkeypatch.setattr(dashboard, "http_client", SimpleNamespace(get=fake_get, post=fake_post))

    request = SimpleNamespace(state=SimpleNamespace(user_id="user-123", name="Dev User", account_type="dev"))
    response = await dashboard.get_monthly_report(request, month="2025-01")

    assert response.media_type == "application/pdf"
