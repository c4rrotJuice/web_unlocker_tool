import asyncio
import importlib
from datetime import datetime, timedelta, timezone
import pytest
import supabase
from fastapi import HTTPException

from app.routes.citations import CitationInput, create_citation
from app.services.free_tier_gating import current_14_day_window, current_week_window, doc_is_archived
from tests.conftest import async_test_client


class DummyAuth:
    def get_user(self, token):
        if token == "valid":
            user = type("U", (), {"id": "user-1", "email": "user@example.com"})
            return type("DummyUser", (), {"user": user})
        return type("DummyUser", (), {"user": None})


class DummyTable:
    def __init__(self, table_name):
        self.table_name = table_name

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        if self.table_name == "user_meta":
            return type("DummyExecute", (), {"data": {"name": "Free User", "account_type": "freemium", "daily_limit": 5}})
        return type("DummyExecute", (), {"data": []})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()

    def table(self, table_name):
        return DummyTable(table_name)



def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    importlib.reload(main)

    async def immediate_supabase_call(fn):
        return fn()

    main._supabase_call = immediate_supabase_call

    redis_data = {}

    async def redis_get(key):
        if key.startswith("user_meta:"):
            return {"name": "Free User", "account_type": "freemium", "daily_limit": 5}
        return redis_data.get(key, 0)

    async def redis_set(key, value, ttl_seconds=None):
        redis_data[key] = value
        return True

    async def redis_incr(key):
        redis_data[key] = int(redis_data.get(key, 0)) + 1
        return redis_data[key]

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    return main


def test_free_citation_format_locked():
    citation = CitationInput(
        url="https://example.com",
        excerpt="excerpt",
        quote="citation",
        format="chicago",
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_citation("u1", "free", citation))

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "CITATION_FORMAT_LOCKED"


def test_standard_custom_citation_locked_structured():
    citation = CitationInput(
        url="https://example.com",
        excerpt="excerpt",
        quote="citation",
        format="custom",
        custom_format_name="Custom",
        custom_format_template="{quote}",
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_citation("u1", "standard", citation))

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "CITATION_FORMAT_LOCKED"


def test_pro_citation_does_not_require_url_inside_full_text(monkeypatch):
    from app.routes import citations

    class FakeResponse:
        def __init__(self, status_code, json_data=None):
            self.status_code = status_code
            self._json_data = json_data or []

        def json(self):
            return self._json_data

    class FakeRepo:
        def headers(self, **_kwargs):
            return {"x-test": "1"}

        async def get(self, resource, **kwargs):
            if resource == "sources":
                return FakeResponse(200, [])
            if resource == "citation_renders":
                return FakeResponse(200, [])
            return FakeResponse(200, [])

        async def post(self, resource, **kwargs):
            if resource == "sources":
                payload = kwargs["json"]
                return FakeResponse(201, [{"id": "source-1", **payload}])
            if resource == "citation_instances":
                payload = kwargs["json"]
                return FakeResponse(201, [{"id": "citation-1", **payload}])
            if resource == "citation_renders":
                return FakeResponse(201, [])
            return FakeResponse(201, [])

        async def delete(self, resource, **kwargs):
            return FakeResponse(204, [])

    monkeypatch.setattr(citations, "supabase_repo", FakeRepo())

    citation = CitationInput(
        url="https://example.com/source",
        excerpt="excerpt",
        quote="Quoted passage without the URL inlined.",
        format="mla",
    )
    citation_id = asyncio.run(create_citation("u1", "pro", citation))

    assert citation_id == "citation-1"


def test_week_window_helpers_archive_behavior():
    now = datetime(2026, 2, 11, 12, 0, tzinfo=timezone.utc)
    week_start, _ = current_week_window(now)
    archived_created_at = (week_start - timedelta(hours=1)).isoformat()
    current_created_at = (week_start + timedelta(hours=1)).isoformat()

    assert doc_is_archived(archived_created_at, "free", now) is True
    assert doc_is_archived(current_created_at, "free", now) is False


def test_standard_14_day_window_archive_behavior():
    now = datetime(2026, 2, 11, 12, 0, tzinfo=timezone.utc)
    window_start, _ = current_14_day_window(now)
    archived_created_at = (window_start - timedelta(hours=1)).isoformat()
    current_created_at = (window_start + timedelta(hours=1)).isoformat()

    assert doc_is_archived(archived_created_at, "standard", now) is True
    assert doc_is_archived(current_created_at, "standard", now) is False


@pytest.mark.anyio
async def test_extension_unlock_permit_free_user_weekly_limit(monkeypatch):
    main = _build_app(monkeypatch)
    headers = {"Authorization": "Bearer valid"}

    async with async_test_client(main.app) as client:
        for _ in range(10):
            response = await client.post("/api/extension/unlock-permit", json={}, headers=headers)
            assert response.status_code == 200
            assert response.json()["allowed"] is True

        denied = await client.post("/api/extension/unlock-permit", json={}, headers=headers)
    assert denied.status_code == 200
    assert denied.json()["allowed"] is False


@pytest.mark.anyio
async def test_extension_selection_free_doc_limit_returns_editor_redirect(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    async def fake_count(*args, **kwargs):
        return 3

    monkeypatch.setattr(extension, "_count_docs_in_window", fake_count)

    headers = {"Authorization": "Bearer valid"}
    async with async_test_client(main.app) as client:
        response = await client.post(
            "/api/extension/selection",
            json={
                "url": "https://example.com",
                "selected_text": "quoted text",
                "title": "Example",
                "citation_format": "mla",
            },
            headers=headers,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["allowed"] is False
    assert payload["editor_url"].startswith("/editor")
