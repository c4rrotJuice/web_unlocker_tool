import hashlib
import hmac
import importlib
import json

import pytest
import supabase

from tests.conftest import async_test_client


class DummyClient:
    def __init__(self):
        self.auth = type("DummyAuth", (), {"get_user": lambda self, token: type("Resp", (), {"user": None})()})()


class FakeBillingRepository:
    def __init__(self):
        self.webhook_events: dict[str, dict] = {}
        self.customers: dict[str, dict] = {}
        self.customer_by_provider_id: dict[str, str] = {}
        self.subscriptions: dict[str, dict] = {}
        self.entitlement_updates: list[dict] = []

    async def fetch_customer(self, user_id: str):
        return self.customers.get(user_id)

    async def fetch_subscription(self, user_id: str):
        for row in self.subscriptions.values():
            if row["user_id"] == user_id:
                return row
        return None

    async def fetch_customer_by_provider_customer_id(self, provider_customer_id: str):
        user_id = self.customer_by_provider_id.get(provider_customer_id)
        return self.customers.get(user_id) if user_id else None

    async def fetch_subscription_by_provider_subscription_id(self, provider_subscription_id: str):
        return self.subscriptions.get(provider_subscription_id)

    async def fetch_webhook_event(self, event_id: str):
        return self.webhook_events.get(event_id)

    async def create_webhook_event(self, *, event_id: str, event_type: str, occurred_at: str | None, payload: dict[str, object]):
        if event_id in self.webhook_events:
            return self.webhook_events[event_id], False
        record = {
            "id": f"evt-{len(self.webhook_events) + 1}",
            "event_id": event_id,
            "event_type": event_type,
            "occurred_at": occurred_at,
            "payload": payload,
            "processed_at": None,
            "last_error": None,
        }
        self.webhook_events[event_id] = record
        return record, True

    async def mark_webhook_event_processed(self, *, record_id: str, last_error: str | None = None):
        for record in self.webhook_events.values():
            if record["id"] == record_id:
                record["processed_at"] = "2026-03-17T00:00:00Z"
                record["last_error"] = last_error

    async def mark_webhook_event_failed(self, *, record_id: str, last_error: str):
        for record in self.webhook_events.values():
            if record["id"] == record_id:
                record["last_error"] = last_error

    async def upsert_billing_customer(self, *, user_id: str, provider_customer_id: str):
        self.customer_by_provider_id[provider_customer_id] = user_id
        self.customers[user_id] = {
            "user_id": user_id,
            "provider_customer_id": provider_customer_id,
        }

    async def upsert_billing_subscription(
        self,
        *,
        user_id: str,
        provider_subscription_id: str,
        provider_price_id: str | None,
        tier: str,
        status: str,
        current_period_end: str | None,
        cancel_at_period_end: bool,
        payload: dict[str, object],
    ):
        self.subscriptions[provider_subscription_id] = {
            "user_id": user_id,
            "provider_subscription_id": provider_subscription_id,
            "provider_price_id": provider_price_id,
            "tier": tier,
            "status": status,
            "current_period_end": current_period_end,
            "cancel_at_period_end": cancel_at_period_end,
            "payload": payload,
        }

    async def update_entitlement(self, *, user_id: str, tier: str, status: str, paid_until: str | None, auto_renew: bool, source: str = "paddle"):
        self.entitlement_updates.append(
            {
                "user_id": user_id,
                "tier": tier,
                "status": status,
                "paid_until": paid_until,
                "auto_renew": auto_renew,
                "source": source,
            }
        )


def _signature(secret: str, payload: dict[str, object], timestamp: str = "1700000000") -> str:
    raw = json.dumps(payload).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), f"{timestamp}:{raw.decode('utf-8')}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"ts={timestamp};v1={digest}"


def _load_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("PADDLE_STANDARD_MONTHLY_PRICE_ID", "price_standard_monthly")
    monkeypatch.setenv("PADDLE_STANDARD_YEARLY_PRICE_ID", "price_standard_yearly")
    monkeypatch.setenv("PADDLE_PRO_MONTHLY_PRICE_ID", "price_pro_monthly")
    monkeypatch.setenv("PADDLE_PRO_YEARLY_PRICE_ID", "price_pro_yearly")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.core.errors as core_errors
    from app import main
    from app.modules.billing import service as billing_service
    from app.modules.billing import routes as billing_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    importlib.reload(core_errors)
    billing_service = importlib.reload(billing_service)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    billing_routes = importlib.reload(billing_routes)
    main = importlib.reload(main)
    billing_routes.service.repository = FakeBillingRepository()
    return main.app, billing_routes.service.repository


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_verified_subscription_event_mutates_only_canonical_billing_state(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-1",
        "event_type": "subscription.created",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-1",
            "subscription_id": "sub-1",
            "status": "active",
            "items": [{"price_id": "pri_01kf781jrxcwtg70bxky3316fr"}],
            "current_billing_period": {"ends_at": "2026-04-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert repo.customers["user-1"]["provider_customer_id"] == "cust-1"
    assert repo.subscriptions["sub-1"]["tier"] == "pro"
    assert repo.entitlement_updates[-1] == {
        "user_id": "user-1",
        "tier": "pro",
        "status": "active",
        "paid_until": "2026-04-17T00:00:00Z",
        "auto_renew": True,
        "source": "paddle",
    }


@pytest.mark.anyio
async def test_transaction_completed_event_finalizes_canonical_billing_state(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-transaction-completed",
        "event_type": "transaction.completed",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-2",
            "subscription_id": "sub-2",
            "status": "completed",
            "items": [{"price_id": "price_pro_yearly"}],
            "billing_period": {"ends_at": "2027-03-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1", "tier": "pro"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert repo.customers["user-1"]["provider_customer_id"] == "cust-2"
    assert repo.subscriptions["sub-2"]["tier"] == "pro"
    assert repo.entitlement_updates[-1] == {
        "user_id": "user-1",
        "tier": "pro",
        "status": "active",
        "paid_until": "2027-03-17T00:00:00Z",
        "auto_renew": True,
        "source": "paddle",
    }


@pytest.mark.anyio
async def test_transaction_completed_uses_billing_period_to_populate_paid_until(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-transaction-paid-until",
        "event_type": "transaction.completed",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-3",
            "subscription_id": "sub-3",
            "status": "completed",
            "items": [{"price_id": "price_standard_monthly"}],
            "billing_period": {"ends_at": "2026-04-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1", "tier": "standard"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert repo.entitlement_updates[-1]["paid_until"] == "2026-04-17T00:00:00Z"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("price_id", "expected_tier"),
    [
        ("price_standard_monthly", "standard"),
        ("price_standard_yearly", "standard"),
        ("price_pro_monthly", "pro"),
        ("price_pro_yearly", "pro"),
    ],
)
async def test_supported_price_ids_map_to_canonical_tiers(monkeypatch, price_id, expected_tier):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": f"evt-{price_id}",
        "event_type": "subscription.updated",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-1",
            "subscription_id": "sub-1",
            "status": "active",
            "items": [{"price_id": price_id}],
            "current_billing_period": {"ends_at": "2026-04-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert repo.subscriptions["sub-1"]["tier"] == expected_tier
    assert repo.subscriptions["sub-1"]["provider_price_id"] == price_id
    assert repo.entitlement_updates[-1]["tier"] == expected_tier


@pytest.mark.anyio
async def test_invalid_signature_rejects_without_mutation(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-2",
        "event_type": "subscription.created",
        "data": {"custom_data": {"user_id": "user-1"}},
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": "ts=1700000000;v1=invalid"},
            content=json.dumps(payload),
        )

    assert response.status_code == 400
    assert repo.entitlement_updates == []
    assert repo.webhook_events == {}


@pytest.mark.anyio
async def test_duplicate_event_is_deduped_and_replay_safe(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-3",
        "event_type": "subscription.renewed",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-1",
            "subscription_id": "sub-1",
            "status": "active",
            "items": [{"price_id": "pri_01kf77v5j5j1b0fkwb95p0wxew"}],
            "current_billing_period": {"ends_at": "2026-04-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1"},
        },
    }
    headers = {"Paddle-Signature": _signature("secret", payload)}

    async with async_test_client(app) as client:
        first = await client.post("/api/webhooks/paddle", headers=headers, content=json.dumps(payload))
        second = await client.post("/api/webhooks/paddle", headers=headers, content=json.dumps(payload))

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["data"]["status"] == "deduped"
    assert len(repo.entitlement_updates) == 1


@pytest.mark.anyio
async def test_unsupported_event_is_logged_safely_and_does_not_mutate(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-4",
        "event_type": "customer.created",
        "data": {"custom_data": {"user_id": "user-1"}},
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "ignored"
    assert repo.entitlement_updates == []


@pytest.mark.anyio
async def test_missing_user_reference_fails_loudly_and_marks_event_failed(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-5",
        "event_type": "transaction.completed",
        "data": {
            "status": "completed",
            "items": [{"price_id": "price_pro_yearly"}],
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "billing_webhook_missing_user_reference"
    assert repo.entitlement_updates == []
    assert repo.webhook_events["evt-5"]["last_error"]


@pytest.mark.anyio
async def test_unmapped_price_id_fails_loudly_and_marks_event_failed(monkeypatch):
    app, repo = _load_app(monkeypatch)
    payload = {
        "event_id": "evt-6",
        "event_type": "transaction.completed",
        "data": {
            "status": "completed",
            "items": [{"price_id": "price_unknown"}],
            "custom_data": {"user_id": "user-1"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "billing_webhook_unknown_tier"
    assert repo.entitlement_updates == []
    assert repo.webhook_events["evt-6"]["last_error"]


@pytest.mark.anyio
async def test_out_of_order_subscription_event_does_not_overwrite_newer_state(monkeypatch):
    app, repo = _load_app(monkeypatch)
    await repo.upsert_billing_subscription(
        user_id="user-1",
        provider_subscription_id="sub-1",
        provider_price_id="pri_01kf781jrxcwtg70bxky3316fr",
        tier="pro",
        status="active",
        current_period_end="2026-05-17T00:00:00Z",
        cancel_at_period_end=False,
        payload={"webhook_occurred_at": "2026-03-18T00:00:00Z"},
    )
    payload = {
        "event_id": "evt-5",
        "event_type": "subscription.updated",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-1",
            "subscription_id": "sub-1",
            "status": "active",
            "items": [{"price_id": "pri_01kf77v5j5j1b0fkwb95p0wxew"}],
            "current_billing_period": {"ends_at": "2026-04-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1"},
        },
    }

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )

    assert response.status_code == 200
    assert response.json()["data"]["reason"] == "stale_event"
    assert repo.subscriptions["sub-1"]["tier"] == "pro"
    assert repo.entitlement_updates == []
