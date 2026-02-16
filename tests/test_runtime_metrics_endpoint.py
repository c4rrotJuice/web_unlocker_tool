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
        self.user_id = user_id

    def get_user(self, _token):
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyTable:
    def __init__(self, account_type: str):
        self.account_type = account_type

    def select(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data={"id": "ok", "name": "Dev User", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth("user-1")
        self.account_type = account_type

    def table(self, *_args, **_kwargs):
        return DummyTable(self.account_type)


def _build_app(monkeypatch, account_type: str):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv(
        "SUPABASE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    )
    monkeypatch.setenv(
        "SUPABASE_SERVICE_ROLE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    )
    monkeypatch.setattr(supabase, "create_client", lambda *_args, **_kwargs: DummyClient(account_type))

    from app import main

    importlib.reload(main)
    return main.app


def test_metrics_endpoint_requires_dev_account(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard")

    with TestClient(app) as client:
        response = client.get("/metrics", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Metrics access requires a dev account."


def test_metrics_endpoint_exposes_runtime_gauges_for_dev(monkeypatch):
    app = _build_app(monkeypatch, account_type="dev")

    with TestClient(app) as client:
        response = client.get("/metrics", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert "process_memory_rss_mb" in response.text
    assert "unlock_pipeline_queue_depth" in response.text
    assert "unlock_pipeline_in_flight" in response.text
