import importlib
import supabase
from fastapi.testclient import TestClient


class DummyAuth:
    def get_user(self, token):
        return type("DummyUser", (), {"user": None})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def execute(self):
        return type("DummyExecute", (), {"data": []})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()

    def table(self, *args, **kwargs):
        return DummyTable()


def _load_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("CORS_ORIGINS", "https://web-unlocker-tool.onrender.com")

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    from app import main

    return importlib.reload(main)


def test_request_id_is_returned_and_logged(monkeypatch, caplog):
    main = _load_main(monkeypatch)
    client = TestClient(main.app)

    request_id = "req-test-123"
    response = client.get("/api/public-config", headers={"X-Request-Id": request_id})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == request_id

    completed_records = [r for r in caplog.records if r.message == "request.completed"]
    assert completed_records

    match = None
    for record in completed_records:
        if getattr(record, "request_id", None) == request_id and getattr(record, "route", None) == "/api/public-config":
            match = record
            break

    assert match is not None
    assert getattr(match, "status", None) == 200
    assert isinstance(getattr(match, "latency_ms", None), (float, int))
