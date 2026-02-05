import json
from types import SimpleNamespace

import pytest

from app.routes import payments


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else []
        self.text = text

    def json(self):
        return self._payload


class FakeHttpClient:
    def __init__(self, lookup_rows=None):
        self.lookup_rows = lookup_rows or []
        self.patch_calls = []

    async def get(self, url, params=None, headers=None):
        if params and "paddle_customer_id" in params:
            return FakeResponse(status_code=200, payload=self.lookup_rows)
        return FakeResponse(status_code=200, payload=[])

    async def patch(self, url, params=None, headers=None, json=None):
        self.patch_calls.append(
            {"url": url, "params": params, "headers": headers, "json": json}
        )
        return FakeResponse(status_code=200, payload=[json])


class FakeRequest:
    def __init__(self, payload, signature=""):
        self._raw = json.dumps(payload).encode("utf-8")
        self.headers = {"Paddle-Signature": signature}
        self.app = SimpleNamespace(state=SimpleNamespace(redis_set=self._redis_set))
        self.cache = {}

    async def body(self):
        return self._raw

    async def _redis_set(self, key, value, ttl_seconds=None):
        self.cache[key] = {"value": value, "ttl_seconds": ttl_seconds}


@pytest.mark.anyio
async def test_webhook_updates_subscription_without_custom_data(monkeypatch):
    fake_http = FakeHttpClient(lookup_rows=[{"user_id": "user-123"}])
    monkeypatch.setattr(payments, "http_client", fake_http)
    monkeypatch.setattr(payments, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(payments, "SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(payments, "PADDLE_WEBHOOK_SECRET", None)

    payload = {
        "event_type": "subscription.renewed",
        "data": {
            "subscription_id": "sub_123",
            "status": "active",
            "customer_id": "ctm_123",
            "items": [{"price_id": "pri_01kf781jrxcwtg70bxky3316fr"}],
            "current_billing_period": {"ends_at": "2026-03-01T00:00:00Z"},
        },
    }

    request = FakeRequest(payload)
    response = await payments.paddle_webhook(request)

    assert response.status_code == 200
    patch_payload = fake_http.patch_calls[0]["json"]
    assert patch_payload["account_type"] == "pro"
    assert patch_payload["paddle_customer_id"] == "ctm_123"
    assert patch_payload["paddle_subscription_id"] == "sub_123"
    assert patch_payload["auto_renew"] is True
    assert patch_payload["paid_until"] == "2026-03-01T00:00:00Z"


@pytest.mark.anyio
async def test_webhook_cancellation_reverts_to_free(monkeypatch):
    fake_http = FakeHttpClient(lookup_rows=[{"user_id": "user-456"}])
    monkeypatch.setattr(payments, "http_client", fake_http)
    monkeypatch.setattr(payments, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(payments, "SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(payments, "PADDLE_WEBHOOK_SECRET", None)

    payload = {
        "event_type": "subscription.canceled",
        "data": {
            "subscription_id": "sub_456",
            "status": "canceled",
            "customer_id": "ctm_456",
            "items": [{"price_id": "pri_01kf77v5j5j1b0fkwb95p0wxew"}],
        },
    }

    request = FakeRequest(payload)
    response = await payments.paddle_webhook(request)

    assert response.status_code == 200
    patch_payload = fake_http.patch_calls[0]["json"]
    assert patch_payload["account_type"] == "free"
    assert patch_payload["auto_renew"] is False
    assert patch_payload["paid_until"] is None
    assert patch_payload["auto_renew"] is False


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_verify_signature_uses_timestamp_prefix(monkeypatch):
    monkeypatch.setattr(payments, "PADDLE_WEBHOOK_SECRET", "secret")
    raw = b'{"event_type":"subscription.created"}'

    import hmac
    import hashlib

    digest = hmac.new(
        b"secret",
        b"1700000000:{\"event_type\":\"subscription.created\"}",
        hashlib.sha256,
    ).hexdigest()

    header = f"ts=1700000000;v1={digest}".replace(";", ",")
    assert payments._verify_paddle_signature(raw, header) is True


def test_verify_signature_accepts_multiple_v1_values(monkeypatch):
    monkeypatch.setattr(payments, "PADDLE_WEBHOOK_SECRET", "secret")
    raw = b'{"event_type":"subscription.created"}'

    import hmac
    import hashlib

    valid_digest = hmac.new(
        b"secret",
        b"1700000000:{\"event_type\":\"subscription.created\"}",
        hashlib.sha256,
    ).hexdigest()

    header = f"ts=1700000000;v1=invalid;v1={valid_digest}"
    assert payments._verify_paddle_signature(raw, header) is True


def test_verify_signature_falls_back_when_v1_empty(monkeypatch):
    monkeypatch.setattr(payments, "PADDLE_WEBHOOK_SECRET", "secret")
    raw = b'{"event_type":"subscription.created"}'

    import hmac
    import hashlib

    valid_digest = hmac.new(
        b"secret",
        b"1700000000:{\"event_type\":\"subscription.created\"}",
        hashlib.sha256,
    ).hexdigest()

    header = f"ts=1700000000;v1=;h1={valid_digest}"
    assert payments._verify_paddle_signature(raw, header) is True
