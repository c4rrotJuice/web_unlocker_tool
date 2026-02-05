import importlib
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self._user_id = user_id

    def get_user(self, token):
        return type("DummyUserResponse", (), {"user": DummyUser(self._user_id)})


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
        return type("DummySelectResponse", (), {"data": {}})


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


class ExchangeTable:
    def __init__(self, record):
        self.record = record
        self.update_payload = None
        self.use_used_at_guard = False

    def select(self, *args, **kwargs):
        return self

    def eq(self, field, value):
        if field == "code":
            return self
        if field == "id":
            return self
        return self

    def single(self, *args, **kwargs):
        return self

    def update(self, payload):
        self.update_payload = payload
        return self

    def is_(self, field, value):
        if field == "used_at" and value == "null":
            self.use_used_at_guard = True
        return self

    def execute(self):
        if self.update_payload is None:
            return SimpleNamespace(data=self.record, error=None)
        if self.record.get("used_at") is not None:
            return SimpleNamespace(data=[], error=None)
        self.record["used_at"] = "now"
        return SimpleNamespace(data=[self.record], error=None)


class ExchangeAdminClient:
    def __init__(self, record):
        self._table = ExchangeTable(record)

    def table(self, *args, **kwargs):
        return self._table


class ExchangeAnonAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.first_get_user = True

    def get_user(self, token):
        if self.first_get_user:
            self.first_get_user = False
            raise Exception("expired")
        return SimpleNamespace(user=DummyUser(self.user_id))

    def refresh_session(self, refresh_token):
        session = SimpleNamespace(
            access_token="new-access",
            refresh_token="new-refresh",
            expires_in=600,
            token_type="bearer",
        )
        return SimpleNamespace(session=session)


class ExchangeAnonClient:
    def __init__(self, user_id: str):
        self.auth = ExchangeAnonAuth(user_id)


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-1"))

    from app import main

    importlib.reload(main)
    return main


def test_create_handoff_success(monkeypatch):
    main = _build_app(monkeypatch)
    client = TestClient(main.app)
    response = client.post(
        "/api/auth/handoff",
        json={"refresh_token": "refresh-token", "redirect_path": "/editor"},
        headers={"Authorization": "Bearer access-token"},
    )

    assert response.status_code == 200
    data = response.json()
    assert isinstance(data.get("code"), str)
    assert data["code"]
    assert data["redirect_path"] == "/editor"


def test_exchange_rotates_tokens_after_refresh(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import auth_handoff

    record = {
        "id": "handoff-id",
        "code": "abc",
        "user_id": "user-1",
        "redirect_path": "/editor?doc=1",
        "access_token": "old-access",
        "refresh_token": "old-refresh",
        "expires_in": 3600,
        "token_type": "bearer",
        "expires_at": "2999-01-01T00:00:00+00:00",
        "used_at": None,
    }
    admin = ExchangeAdminClient(record)
    auth_handoff.supabase_admin = admin
    auth_handoff.supabase_anon = ExchangeAnonClient("user-1")

    client = TestClient(main.app)
    response = client.post("/api/auth/handoff/exchange", json={"code": "abc"})

    assert response.status_code == 200
    assert response.json()["redirect_path"] == "/editor?doc=1"
    assert admin._table.use_used_at_guard is True
    cookie_header = response.headers.get("set-cookie", "")
    assert "access_token=new-access" in cookie_header
    assert "refresh_token=new-refresh" in cookie_header


def test_exchange_rejects_reuse_race(monkeypatch):
    main = _build_app(monkeypatch)

    from app.routes import auth_handoff

    record = {
        "id": "handoff-id",
        "code": "abc",
        "user_id": "user-1",
        "redirect_path": "/editor",
        "access_token": "old-access",
        "refresh_token": "old-refresh",
        "expires_in": 3600,
        "token_type": "bearer",
        "expires_at": "2999-01-01T00:00:00+00:00",
        "used_at": "already-used",
    }
    auth_handoff.supabase_admin = ExchangeAdminClient(record)
    auth_handoff.supabase_anon = ExchangeAnonClient("user-1")

    client = TestClient(main.app)
    response = client.post("/api/auth/handoff/exchange", json={"code": "abc"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Code already used."
