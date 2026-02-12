import importlib
import time
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


class SlowAuth:
    def get_user(self, token):
        time.sleep(0.2)
        return SimpleNamespace(user=None)


class FastAuth:
    def get_user(self, token):
        return SimpleNamespace(user=SimpleNamespace(id="user-1", email="u@example.com"))


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data={"name": "User", "account_type": "pro", "daily_limit": 5})


class DummyClient:
    def __init__(self, slow=False):
        self.auth = SlowAuth() if slow else FastAuth()

    def table(self, *args, **kwargs):
        return DummyTable()


def _build_app(monkeypatch, *, slow_auth=False):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("SUPABASE_CALL_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setenv("SUPABASE_RETRY_ATTEMPTS", "2")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(slow=slow_auth))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

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
    return main


def test_auth_critical_endpoint_fails_closed_on_supabase_timeout(monkeypatch):
    main = _build_app(monkeypatch, slow_auth=True)
    client = TestClient(main.app)

    started = time.perf_counter()
    response = client.get("/editor", headers={"Authorization": "Bearer token"}, follow_redirects=False)
    elapsed = time.perf_counter() - started

    assert response.status_code == 401
    assert elapsed < 0.7


def test_momentum_returns_partial_response_when_dependency_times_out(monkeypatch):
    main = _build_app(monkeypatch, slow_auth=False)
    client = TestClient(main.app)

    async def timeout_unlock_days(_user_id):
        raise TimeoutError("supabase timeout")

    monkeypatch.setattr(main.dashboard, "_fetch_unlock_days", timeout_unlock_days)

    response = client.get("/api/dashboard/momentum", headers={"Authorization": "Bearer token"})

    assert response.status_code == 206
    payload = response.json()
    assert payload["degraded"] is True
    assert payload["error_code"] == "MOMENTUM_PARTIAL_DATA"
    assert payload["articles_unlocked_mtd"] == 0
