import importlib
from types import SimpleNamespace

import pytest
import supabase

from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, token):
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyInsert:
    def execute(self):
        return SimpleNamespace(data=[{"id": 1}], error=None)


class DummyTable:
    def __init__(self, user_id: str, account_type: str):
        self.user_id = user_id
        self.account_type = account_type

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        return self

    def single(self):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return SimpleNamespace(
            data={"name": "T", "account_type": self.account_type, "daily_limit": 5}
        )


class DummyClient:
    def __init__(self, user_id: str, account_type: str):
        self.auth = DummyAuth(user_id)
        self.user_id = user_id
        self.account_type = account_type

    def table(self, *args, **kwargs):
        return DummyTable(self.user_id, self.account_type)


def _build_app(monkeypatch, account_type="pro"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(
        supabase,
        "create_client",
        lambda url, key: DummyClient("user-1", account_type),
    )

    from app import main

    importlib.reload(main)

    async def immediate_supabase_call(fn):
        return fn()

    main._supabase_call = immediate_supabase_call

    async def redis_get(_key):
        return {"name": "T", "account_type": account_type, "daily_limit": 5}

    async def redis_set(_key, _value, ttl_seconds=None):
        return True

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    return main.app


@pytest.mark.anyio
async def test_editor_allows_authenticated_cookie_user(monkeypatch):
    app = _build_app(monkeypatch)
    async with async_test_client(app, follow_redirects=False) as client:
        response = await client.get(
            "/editor",
            cookies={"wu_access_token": "good-token"},
        )

    assert response.status_code == 200
    assert "Writior Editor" in response.text


@pytest.mark.anyio
async def test_editor_redirects_to_auth_without_token(monkeypatch):
    app = _build_app(monkeypatch)
    async with async_test_client(app, follow_redirects=False) as client:
        response = await client.get("/editor")

    assert response.status_code == 302
    assert response.headers["location"] == "/auth"


@pytest.mark.anyio
async def test_editor_redirects_free_tier_to_pricing(monkeypatch):
    app = _build_app(monkeypatch, account_type="free")
    async with async_test_client(app, follow_redirects=False) as client:
        response = await client.get(
            "/editor",
            cookies={"wu_access_token": "good-token"},
        )

    assert response.status_code == 200
    assert "Writior Editor" in response.text
