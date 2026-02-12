from fastapi import HTTPException
import pytest

from app.services.supabase_rest import SupabaseRestRepository


class FakeResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


class FakeClient:
    def __init__(self):
        self.calls = []

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return FakeResponse(200)


@pytest.mark.anyio
async def test_headers_include_auth_and_prefer():
    repo = SupabaseRestRepository(base_url="https://demo.supabase.co", service_role_key="service-key")

    headers = repo.headers(prefer="return=representation")

    assert headers["apikey"] == "service-key"
    assert headers["Authorization"] == "Bearer service-key"
    assert headers["Content-Type"] == "application/json"
    assert headers["Prefer"] == "return=representation"


@pytest.mark.anyio
async def test_request_builds_rest_v1_resource_url(monkeypatch):
    repo = SupabaseRestRepository(base_url="https://demo.supabase.co", service_role_key="service-key")
    fake_client = FakeClient()

    import app.services.supabase_rest as supabase_rest

    monkeypatch.setattr(supabase_rest, "http_client", fake_client)

    response = await repo.get("user_meta", params={"limit": 1}, headers=repo.headers())

    assert response.status_code == 200
    assert fake_client.calls[0][1] == "https://demo.supabase.co/rest/v1/user_meta"


def test_headers_raise_when_service_role_missing():
    repo = SupabaseRestRepository(base_url="https://demo.supabase.co", service_role_key=None)

    with pytest.raises(HTTPException) as exc_info:
        repo.headers()

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Supabase service role key missing."


@pytest.fixture
def anyio_backend():
    return "asyncio"
