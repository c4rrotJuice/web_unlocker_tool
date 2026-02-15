import importlib

import supabase


class DummyQuery:
    def __init__(self, table, action, payload=None):
        self.table = table
        self.action = action
        self.payload = payload
        self.filters = []

    def select(self, *args, **kwargs):
        self.table.select_calls.append((args, kwargs))
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def limit(self, value):
        self.table.limit_calls.append(value)
        return self

    def execute(self):
        if self.action == "select":
            return type("DummyResult", (), {"data": self.table.existing_rows})
        if self.action == "insert":
            self.table.insert_calls.append(self.payload)
            return type("DummyResult", (), {"data": [self.payload]})
        if self.action == "update":
            self.table.update_calls.append((self.payload, list(self.filters)))
            return type("DummyResult", (), {"data": [self.payload]})
        raise AssertionError(f"Unsupported action: {self.action}")


class DummyTable:
    def __init__(self, existing_rows):
        self.existing_rows = existing_rows
        self.select_calls = []
        self.limit_calls = []
        self.insert_calls = []
        self.update_calls = []

    def select(self, *args, **kwargs):
        return DummyQuery(self, "select").select(*args, **kwargs)

    def insert(self, payload):
        return DummyQuery(self, "insert", payload)

    def update(self, payload):
        return DummyQuery(self, "update", payload)


class DummySupabase:
    def __init__(self, existing_rows=None):
        self.user_meta_table = DummyTable(existing_rows or [])

    def table(self, name):
        assert name == "user_meta"
        return self.user_meta_table


def _load_auth_module(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummySupabase())

    from app.services import authentication

    return importlib.reload(authentication)


def _payload(authentication):
    return authentication.SignupRequest(
        name="Ada Lovelace",
        email="ada@example.com",
        password="test-password",
        use_case="research",
    )


def test_sync_user_meta_inserts_when_missing(monkeypatch):
    authentication = _load_auth_module(monkeypatch)
    dummy = DummySupabase(existing_rows=[])
    monkeypatch.setattr(authentication, "supabase", dummy)

    authentication._sync_user_meta(user_id="user-1", payload=_payload(authentication))

    assert len(dummy.user_meta_table.insert_calls) == 1
    inserted = dummy.user_meta_table.insert_calls[0]
    assert inserted["user_id"] == "user-1"
    assert inserted["name"] == "Ada Lovelace"
    assert inserted["use_case"] == "research"
    assert inserted["account_type"] == "free"
    assert inserted["daily_limit"] == 5
    assert inserted["requests_today"] == 0


def test_sync_user_meta_updates_existing_row(monkeypatch):
    authentication = _load_auth_module(monkeypatch)
    dummy = DummySupabase(existing_rows=[{"id": "meta-1"}])
    monkeypatch.setattr(authentication, "supabase", dummy)

    authentication._sync_user_meta(user_id="user-1", payload=_payload(authentication))

    assert dummy.user_meta_table.insert_calls == []
    assert len(dummy.user_meta_table.update_calls) == 1
    updated_payload, filters = dummy.user_meta_table.update_calls[0]
    assert updated_payload["name"] == "Ada Lovelace"
    assert ("id", "meta-1") in filters
