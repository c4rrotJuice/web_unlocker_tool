import importlib

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, token):
        return type("DummyUserResponse", (), {"user": DummyUser(self.user_id)})



class DummyInsert:
    def execute(self):
        return type("DummyInsertResponse", (), {"data": [{"id": 1}]})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return type(
            "DummyExecute",
            (),
            {"data": {"name": "Tester", "account_type": "standard", "daily_limit": 5}},
        )


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-evt"))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    main.app.state.http_session = None
    return main


def test_extension_usage_event_requires_auth(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)

    response = client.post(
        "/api/extension/usage-event",
        json={"url": "https://example.com", "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f"},
    )

    assert response.status_code == 401


def test_extension_usage_event_records_as_extension(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import extension

    captured = {}

    async def fake_save_unlock_history(user_id, url, token, client, source="web", event_id=None):
        captured.update(
            {
                "user_id": user_id,
                "url": url,
                "source": source,
                "event_id": event_id,
            }
        )
        return "inserted"

    extension.save_unlock_history = fake_save_unlock_history

    client = TestClient(main.app)
    response = client.post(
        "/api/extension/usage-event",
        headers={"Authorization": "Bearer token"},
        json={"url": "https://example.com/article", "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "deduped": False}
    assert captured == {
        "user_id": "user-evt",
        "url": "https://example.com/article",
        "source": "extension",
        "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f",
    }


def test_extension_usage_event_idempotent(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import extension

    seen = set()

    async def fake_save_unlock_history(user_id, url, token, client, source="web", event_id=None):
        key = (user_id, event_id)
        if key in seen:
            return "duplicate"
        seen.add(key)
        return "inserted"

    extension.save_unlock_history = fake_save_unlock_history

    client = TestClient(main.app)
    payload = {
        "url": "https://example.com/article",
        "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f",
    }

    first = client.post(
        "/api/extension/usage-event",
        headers={"Authorization": "Bearer token"},
        json=payload,
    )
    second = client.post(
        "/api/extension/usage-event",
        headers={"Authorization": "Bearer token"},
        json=payload,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["deduped"] is False
    assert second.json()["deduped"] is True


def test_extension_usage_event_write_failure(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import extension

    async def fake_save_unlock_history(user_id, url, token, client, source="web", event_id=None):
        return "failed"

    extension.save_unlock_history = fake_save_unlock_history

    client = TestClient(main.app)
    response = client.post(
        "/api/extension/usage-event",
        headers={"Authorization": "Bearer token"},
        json={"url": "https://example.com/article", "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Failed to record extension usage event."


def test_extension_usage_event_fallback_without_unique_constraint(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import extension, render

    extension.save_unlock_history = render.save_unlock_history

    class FakeResponse:
        def __init__(self, status_code, payload=None, text=""):
            self.status_code = status_code
            self._payload = payload
            self.text = text

        def json(self):
            return self._payload

    class FakeHttpClient:
        def __init__(self):
            self.post_calls = 0

        async def post(self, *_args, **kwargs):
            self.post_calls += 1
            if self.post_calls == 1:
                return FakeResponse(
                    400,
                    {
                        "code": "42P10",
                        "message": "there is no unique or exclusion constraint matching the ON CONFLICT specification",
                    },
                    text='{"code":"42P10"}',
                )
            return FakeResponse(201, [{"id": "inserted"}], text='[{"id":"inserted"}]')

        async def get(self, *_args, **_kwargs):
            return FakeResponse(200, [], text='[]')

    main.app.state.http_session = FakeHttpClient()

    client = TestClient(main.app)
    response = client.post(
        "/api/extension/usage-event",
        headers={"Authorization": "Bearer token"},
        json={"url": "https://example.com/article", "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "deduped": False}
