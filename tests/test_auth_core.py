import importlib

import pytest
import supabase

from app.core.account_state import AccountStateService
from app.core.auth import RequestAuthContext
from app.core.entitlements import derive_capability_state
from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1")})


class InvalidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": None})


class ExpiredAuth:
    def get_user(self, token):
        raise Exception("token expired")


class DummyClient:
    def __init__(self, auth):
        self.auth = auth


class FakeIdentityRepository:
    async def fetch_profile(self, user_id: str):
        return {"display_name": "User One", "use_case": "research"}

    async def fetch_preferences(self, user_id: str):
        return None

    async def fetch_entitlement(self, user_id: str):
        return {"tier": "standard", "status": "grace_period", "paid_until": "2099-01-01T00:00:00Z", "auto_renew": True, "source": "paddle"}

    async def fetch_billing_customer(self, user_id: str):
        return {"id": "cust-1", "provider": "paddle", "provider_customer_id": "pc_1"}

    async def fetch_billing_subscription(self, user_id: str):
        return {"id": "sub-1", "provider": "paddle", "provider_subscription_id": "ps_1", "tier": "standard", "status": "active", "cancel_at_period_end": False, "payload": {}}


def _load_main(monkeypatch, *, auth_impl):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(auth_impl))

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main
    from app.modules.identity import routes as identity_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    fake_repo = FakeIdentityRepository()
    identity_routes.service.repository = fake_repo
    identity_routes.service.account_state_service = AccountStateService(fake_repo)
    return main


@pytest.mark.anyio
async def test_protected_route_rejects_missing_bearer(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/identity/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "missing_credentials"


@pytest.mark.anyio
async def test_protected_route_rejects_invalid_and_cookie_only_auth(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=InvalidAuth())
    async with async_test_client(main.app) as client:
        invalid = await client.get("/api/identity/me", headers={"Authorization": "Bearer invalid-token"})
        cookie_only = await client.get("/api/identity/me", headers={"Cookie": "wu_access_token=legacy"})

    assert invalid.status_code == 401
    assert invalid.json()["error"]["code"] == "invalid_token"
    assert cookie_only.status_code == 401
    assert cookie_only.json()["error"]["code"] == "missing_credentials"


@pytest.mark.anyio
async def test_protected_route_rejects_expired_token(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ExpiredAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/identity/me", headers={"Authorization": "Bearer expired-token"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "expired_token"


@pytest.mark.anyio
async def test_protected_route_accepts_valid_token_and_returns_context(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/identity/me", headers={"Authorization": "Bearer valid-token"})

    payload = response.json()
    assert response.status_code == 200
    assert payload["authenticated"] is True
    assert payload["user_id"] == "user-1"
    assert payload["email"] == "user@example.com"
    assert payload["token_claims"]["sub"] == "user-1"


@pytest.mark.anyio
async def test_account_and_capabilities_use_canonical_shared_path(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    headers = {"Authorization": "Bearer valid-token"}
    async with async_test_client(main.app) as client:
        account_response = await client.get("/api/identity/account", headers=headers)
        capability_response = await client.get("/api/identity/capabilities", headers=headers)

    account = account_response.json()
    capabilities = capability_response.json()
    assert account_response.status_code == 200
    assert account["profile"]["display_name"] == "User One"
    assert account["preferences"]["theme"] == "system"
    assert account["entitlement"]["tier"] == "standard"
    assert capability_response.status_code == 200
    assert capabilities["tier"] == "standard"
    assert capabilities["status"] == "grace_period"
    assert capabilities["capabilities"]["bookmarks"] is True
    assert set(capabilities["capabilities"].keys()) >= {
        "unlocks",
        "documents",
        "exports",
        "citation_styles",
        "zip_export",
        "bookmarks",
        "reports",
    }


def test_request_auth_context_contract():
    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        token_claims={"sub": "user-1"},
        account_state=None,
        capability_state=derive_capability_state(user_id="user-1", tier="free", status="active", paid_until=None),
    )

    assert auth_context.authenticated is True
    assert isinstance(auth_context.user_id, str)
    assert hasattr(auth_context, "token_claims")
    assert hasattr(auth_context, "account_state")
    assert hasattr(auth_context, "capability_state")
