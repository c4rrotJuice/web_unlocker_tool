import importlib

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email


class DummyAuth:
    def get_user(self, token):
        if token == "valid-token":
            return type("DummyUserResponse", (), {"user": DummyUser("user-123")})
        return type("DummyUserResponse", (), {"user": None})


class DummyTableQuery:
    def __init__(self, key: str):
        self.key = key

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        if self.key == "service":
            return type(
                "DummyExecute",
                (),
                {"data": {"name": "Ada", "account_type": "pro", "daily_limit": 5}},
            )
        return type("DummyExecute", (), {"data": []})


class DummyClient:
    def __init__(self, key: str):
        self.key = key
        self.auth = DummyAuth()

    def table(self, *args, **kwargs):
        return DummyTableQuery(self.key)


def _make_client(_url, key):
    return DummyClient(key)


def _reload_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", _make_client)

    from app import main

    importlib.reload(main)
    return main


def test_editor_redirects_to_auth_without_user_token(monkeypatch):
    main = _reload_main(monkeypatch)
    client = TestClient(main.app)

    response = client.get("/editor", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/static/auth.html"


def test_editor_allows_paid_user_when_cookie_token_is_valid(monkeypatch):
    main = _reload_main(monkeypatch)
    client = TestClient(main.app)

    response = client.get(
        "/editor",
        cookies={"wu_access_token": "valid-token"},
        follow_redirects=False,
    )

    assert response.status_code == 200
    assert "Research Editor" in response.text


def test_editor_redirects_free_user_to_pricing(monkeypatch):
    main = _reload_main(monkeypatch)

    original_make_client = _make_client

    def free_client(url, key):
        client = original_make_client(url, key)
        if key == "service":
            original_table = client.table

            def free_table(*args, **kwargs):
                table = original_table(*args, **kwargs)
                table.execute = lambda: type(
                    "DummyExecute",
                    (),
                    {"data": {"name": "Ada", "account_type": "free", "daily_limit": 5}},
                )
                return table

            client.table = free_table
        return client

    monkeypatch.setattr(supabase, "create_client", free_client)
    importlib.reload(main)

    client = TestClient(main.app)
    response = client.get(
        "/editor",
        cookies={"wu_access_token": "valid-token"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/static/pricing.html"
