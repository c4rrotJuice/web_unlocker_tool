import hashlib
import hmac
import importlib
import json
from contextlib import asynccontextmanager

import httpx
import pytest
import supabase

from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class DummyAuth:
    def get_user(self, token):
        if token == "valid-token":
            return type("DummyResponse", (), {"user": DummyUser("user-1", "user@example.com")})()
        return type("DummyResponse", (), {"user": None})()


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()


class SharedBillingState:
    def __init__(self):
        self.profile = {
            "display_name": "User One",
            "use_case": "research",
        }
        self.preferences = {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
            "sidebar_auto_hide": False,
        }
        self.entitlement = {
            "tier": "free",
            "status": "active",
            "paid_until": None,
            "auto_renew": False,
            "source": "system",
        }
        self.customer = None
        self.subscription = None
        self.webhook_events: dict[str, dict] = {}


class SharedRepository:
    def __init__(self, state: SharedBillingState):
        self.state = state

    async def fetch_profile(self, user_id: str, access_token: str):
        return self.state.profile

    async def fetch_preferences(self, user_id: str, access_token: str):
        return self.state.preferences

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return self.state.entitlement

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        self.state.profile = {
            "display_name": display_name or "User",
            "use_case": use_case,
        }
        self.state.preferences = {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
            "sidebar_auto_hide": False,
        }
        if self.state.entitlement is None:
            self.state.entitlement = {
                "tier": "free",
                "status": "active",
                "paid_until": None,
                "auto_renew": False,
                "source": "system",
            }
        return True

    async def fetch_customer(self, user_id: str):
        if self.state.customer and self.state.customer.get("user_id") == user_id:
            return self.state.customer
        return None

    async def fetch_subscription(self, user_id: str):
        if self.state.subscription and self.state.subscription.get("user_id") == user_id:
            return self.state.subscription
        return None

    async def fetch_customer_by_provider_customer_id(self, provider_customer_id: str):
        if self.state.customer and self.state.customer.get("provider_customer_id") == provider_customer_id:
            return self.state.customer
        return None

    async def fetch_subscription_by_provider_subscription_id(self, provider_subscription_id: str):
        if self.state.subscription and self.state.subscription.get("provider_subscription_id") == provider_subscription_id:
            return self.state.subscription
        return None

    async def fetch_webhook_event(self, event_id: str):
        return self.state.webhook_events.get(event_id)

    async def create_webhook_event(self, *, event_id: str, event_type: str, occurred_at: str | None, payload: dict[str, object]):
        if event_id in self.state.webhook_events:
            return self.state.webhook_events[event_id], False
        record = {
            "id": f"evt-{len(self.state.webhook_events) + 1}",
            "event_id": event_id,
            "event_type": event_type,
            "occurred_at": occurred_at,
            "payload": payload,
            "processed_at": None,
            "last_error": None,
        }
        self.state.webhook_events[event_id] = record
        return record, True

    async def mark_webhook_event_processed(self, *, record_id: str, last_error: str | None = None):
        for record in self.state.webhook_events.values():
            if record["id"] == record_id:
                record["processed_at"] = "2026-03-17T00:00:00Z"
                record["last_error"] = last_error

    async def mark_webhook_event_failed(self, *, record_id: str, last_error: str):
        for record in self.state.webhook_events.values():
            if record["id"] == record_id:
                record["last_error"] = last_error

    async def upsert_billing_customer(self, *, user_id: str, provider_customer_id: str):
        self.state.customer = {
            "user_id": user_id,
            "provider": "paddle",
            "provider_customer_id": provider_customer_id,
            "created_at": "2026-03-17T00:00:00Z",
            "updated_at": "2026-03-17T00:00:00Z",
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
        self.state.subscription = {
            "user_id": user_id,
            "provider": "paddle",
            "provider_subscription_id": provider_subscription_id,
            "provider_price_id": provider_price_id,
            "tier": tier,
            "status": status,
            "current_period_end": current_period_end,
            "cancel_at_period_end": cancel_at_period_end,
            "payload": payload,
        }

    async def update_entitlement(self, *, user_id: str, tier: str, status: str, paid_until: str | None, auto_renew: bool, source: str = "paddle"):
        self.state.entitlement = {
            "tier": tier,
            "status": status,
            "paid_until": paid_until,
            "auto_renew": auto_renew,
            "source": source,
        }


class FakePaddleResponse:
    def __init__(self, *, status_code: int, payload: dict[str, object], text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class FakePaddleClient:
    def __init__(self, response: FakePaddleResponse | None = None):
        self.calls: list[dict[str, object]] = []
        self.response = response or FakePaddleResponse(
            status_code=200,
            payload={
                "data": {
                    "id": "txn_123",
                    "checkout": {"url": "https://checkout.example/txn_123"},
                }
            },
        )

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.response


def _load_app(monkeypatch, *, state: SharedBillingState | None = None, paddle_client: FakePaddleClient | None = None):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("PADDLE_API_KEY", "paddle_api_key")
    monkeypatch.setenv("PADDLE_API_BASE_URL", "https://api.paddle.com")
    monkeypatch.setenv("PADDLE_STANDARD_MONTHLY_PRICE_ID", "price_standard_monthly")
    monkeypatch.setenv("PADDLE_STANDARD_YEARLY_PRICE_ID", "price_standard_yearly")
    monkeypatch.setenv("PADDLE_PRO_MONTHLY_PRICE_ID", "price_pro_monthly")
    monkeypatch.setenv("PADDLE_PRO_YEARLY_PRICE_ID", "price_pro_yearly")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.modules.billing.service as billing_service
    import app.modules.billing.routes as billing_routes
    import app.modules.identity.routes as identity_routes
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    billing_service = importlib.reload(billing_service)
    billing_routes = importlib.reload(billing_routes)
    identity_routes = importlib.reload(identity_routes)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)

    shared_state = state or SharedBillingState()
    shared_repo = SharedRepository(shared_state)
    billing_routes.service.repository = shared_repo
    identity_routes.service.repository = shared_repo

    if paddle_client is not None:
        monkeypatch.setattr(billing_service, "http_client", paddle_client)

    return main.app, shared_state, paddle_client


def _signature(secret: str, payload: dict[str, object], timestamp: str = "1700000000") -> str:
    raw = json.dumps(payload).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), f"{timestamp}:{raw.decode('utf-8')}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"ts={timestamp};v1={digest}"


@asynccontextmanager
async def _non_raising_client(app):
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    client = httpx.AsyncClient(transport=transport, base_url="http://testserver")
    try:
        yield client
    finally:
        pass


@pytest.mark.anyio
async def test_checkout_requires_bearer_auth(monkeypatch):
    app, _state, _paddle = _load_app(monkeypatch)

    async with _non_raising_client(app) as client:
        response = await client.post("/api/billing/checkout", json={"tier": "standard", "interval": "monthly"})

    assert response.status_code == 401


@pytest.mark.anyio
async def test_checkout_rejects_invalid_tier(monkeypatch):
    app, _state, _paddle = _load_app(monkeypatch)

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": "enterprise", "interval": "monthly"},
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_checkout_rejects_invalid_interval(monkeypatch):
    app, _state, _paddle = _load_app(monkeypatch)

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": "standard", "interval": "quarterly"},
        )

    assert response.status_code == 422


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tier", "interval", "expected_price_id"),
    [
        ("standard", "monthly", "price_standard_monthly"),
        ("standard", "yearly", "price_standard_yearly"),
        ("pro", "monthly", "price_pro_monthly"),
        ("pro", "yearly", "price_pro_yearly"),
    ],
)
async def test_checkout_maps_canonical_tier_interval_to_paddle_price(monkeypatch, tier, interval, expected_price_id):
    paddle_client = FakePaddleClient()
    app, _state, _ = _load_app(monkeypatch, paddle_client=paddle_client)

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": tier, "interval": interval},
        )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["provider"] == "paddle"
    assert payload["tier"] == tier
    assert payload["interval"] == interval
    assert payload["transaction_id"] == "txn_123"
    assert payload["checkout_url"] == "https://checkout.example/txn_123"
    assert paddle_client.calls[0]["url"] == "https://api.paddle.com/transactions"
    assert paddle_client.calls[0]["headers"]["Authorization"] == "Bearer paddle_api_key"
    assert paddle_client.calls[0]["json"]["items"][0]["price_id"] == expected_price_id
    assert paddle_client.calls[0]["json"]["custom_data"] == {
        "user_id": "user-1",
        "tier": tier,
        "interval": interval,
        "email": "user@example.com",
    }


@pytest.mark.anyio
async def test_checkout_can_switch_to_sandbox_via_environment_variable(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("PADDLE_API_KEY", "pdl_sdbx_test_api_key")
    monkeypatch.setenv("PADDLE_ENVIRONMENT", "sandbox")
    monkeypatch.setenv("PADDLE_STANDARD_MONTHLY_PRICE_ID", "price_standard_monthly")
    monkeypatch.setenv("PADDLE_STANDARD_YEARLY_PRICE_ID", "price_standard_yearly")
    monkeypatch.setenv("PADDLE_PRO_MONTHLY_PRICE_ID", "price_pro_monthly")
    monkeypatch.setenv("PADDLE_PRO_YEARLY_PRICE_ID", "price_pro_yearly")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.modules.billing.routes as billing_routes
    import app.modules.billing.service as billing_service
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    billing_service = importlib.reload(billing_service)
    billing_routes = importlib.reload(billing_routes)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    billing_routes.service.repository = SharedRepository(SharedBillingState())

    paddle_client = FakePaddleClient()
    monkeypatch.setattr(billing_service, "http_client", paddle_client)

    async with async_test_client(main.app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": "standard", "interval": "monthly"},
        )

    assert response.status_code == 200
    assert paddle_client.calls[0]["url"] == "https://sandbox-api.paddle.com/transactions"
    assert paddle_client.calls[0]["headers"]["Authorization"] == "Bearer pdl_sdbx_test_api_key"


@pytest.mark.anyio
async def test_checkout_rejects_missing_provider_config_clearly(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.modules.billing.routes as billing_routes
    import app.modules.billing.service as billing_service
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    billing_service = importlib.reload(billing_service)
    billing_routes = importlib.reload(billing_routes)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    billing_routes.service.repository = SharedRepository(SharedBillingState())

    async with async_test_client(main.app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": "standard", "interval": "monthly"},
        )

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "billing_checkout_config_missing"
    assert "PADDLE_API_KEY" in response.json()["error"]["message"]


@pytest.mark.anyio
async def test_checkout_rejects_paddle_environment_mismatch_clearly(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("PADDLE_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("PADDLE_API_KEY", "pdl_sdbx_test_api_key")
    monkeypatch.setenv("PADDLE_API_BASE_URL", "https://api.paddle.com")
    monkeypatch.setenv("PADDLE_STANDARD_MONTHLY_PRICE_ID", "price_standard_monthly")
    monkeypatch.setenv("PADDLE_STANDARD_YEARLY_PRICE_ID", "price_standard_yearly")
    monkeypatch.setenv("PADDLE_PRO_MONTHLY_PRICE_ID", "price_pro_monthly")
    monkeypatch.setenv("PADDLE_PRO_YEARLY_PRICE_ID", "price_pro_yearly")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    import app.modules.billing.routes as billing_routes
    import app.modules.billing.service as billing_service
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    billing_service = importlib.reload(billing_service)
    billing_routes = importlib.reload(billing_routes)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    billing_routes.service.repository = SharedRepository(SharedBillingState())

    paddle_client = FakePaddleClient()
    monkeypatch.setattr(billing_service, "http_client", paddle_client)

    async with async_test_client(main.app) as client:
        response = await client.post(
            "/api/billing/checkout",
            headers={"Authorization": "Bearer valid-token"},
            json={"tier": "standard", "interval": "monthly"},
        )

    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "billing_checkout_config_mismatch"
    assert "environment" in error["message"].lower()
    assert error["details"]["paddle_environment"] == "live"
    assert error["details"]["paddle_api_key_environment"] == "sandbox"
    assert paddle_client.calls == []


@pytest.mark.anyio
async def test_checkout_maps_paddle_forbidden_into_useful_error(monkeypatch, caplog):
    paddle_response = FakePaddleResponse(
        status_code=403,
        payload={
            "type": "request_error",
            "code": "forbidden",
            "detail": "You aren't permitted to perform this request.",
        },
    )
    paddle_client = FakePaddleClient(response=paddle_response)
    app, _state, _ = _load_app(monkeypatch, paddle_client=paddle_client)

    with caplog.at_level("WARNING"):
        async with async_test_client(app) as client:
            response = await client.post(
                "/api/billing/checkout",
                headers={"Authorization": "Bearer valid-token"},
                json={"tier": "standard", "interval": "monthly"},
            )

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "billing_checkout_provider_forbidden"
    assert error["details"]["upstream_status"] == 403
    assert error["details"]["upstream_error_code"] == "forbidden"
    assert error["details"]["paddle_environment"] == "live"
    assert "paddle_api_key" not in json.dumps(error)
    assert "paddle_api_key" not in caplog.text


@pytest.mark.anyio
async def test_webhook_mutation_is_reflected_in_entitlement_readback(monkeypatch):
    state = SharedBillingState()
    app, _state, _paddle = _load_app(monkeypatch, state=state)
    payload = {
        "event_id": "evt-42",
        "event_type": "subscription.created",
        "occurred_at": "2026-03-17T00:00:00Z",
        "data": {
            "customer_id": "cust-42",
            "subscription_id": "sub-42",
            "status": "active",
            "items": [{"price_id": "price_pro_yearly"}],
            "current_billing_period": {"ends_at": "2027-03-17T00:00:00Z"},
            "custom_data": {"user_id": "user-1"},
        },
    }

    async with async_test_client(app) as client:
        webhook_response = await client.post(
            "/api/webhooks/paddle",
            headers={"Paddle-Signature": _signature("secret", payload)},
            content=json.dumps(payload),
        )
        entitlement_response = await client.get(
            "/api/entitlements/current",
            headers={"Authorization": "Bearer valid-token"},
        )

    assert webhook_response.status_code == 200
    assert entitlement_response.status_code == 200
    entitlement_payload = entitlement_response.json()["data"]["entitlement"]
    assert entitlement_payload["tier"] == "pro"
    assert entitlement_payload["status"] == "active"
    assert entitlement_payload["paid_until"] == "2027-03-17T00:00:00Z"
