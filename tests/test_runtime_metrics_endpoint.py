import importlib
from types import SimpleNamespace

import supabase
from fastapi.testclient import TestClient


class DummyAuth:
    def get_user(self, token):
        return SimpleNamespace(user=None)


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data={"id": "ok"})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()

    def table(self, *args, **kwargs):
        return DummyTable()


def test_metrics_endpoint_exposes_runtime_gauges(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv(
        "SUPABASE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    )
    monkeypatch.setenv(
        "SUPABASE_SERVICE_ROLE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.signature",
    )
    monkeypatch.setattr(supabase, "create_client", lambda *_args, **_kwargs: DummyClient())

    from app import main

    importlib.reload(main)
    with TestClient(main.app) as client:
        response = client.get("/metrics")

    assert response.status_code == 200
    assert "process_memory_rss_mb" in response.text
    assert "unlock_pipeline_queue_depth" in response.text
    assert "unlock_pipeline_in_flight" in response.text
