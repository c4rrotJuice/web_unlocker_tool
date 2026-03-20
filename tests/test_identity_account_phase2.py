import importlib

import pytest
import supabase

from tests.conftest import async_test_client


SUPPORTED_PREFERENCE_PATCH_FIELDS = {
    "theme",
    "editor_density",
    "default_citation_style",
    "sidebar_collapsed",
    "sidebar_auto_hide",
}


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1")})


class DummyClient:
    def __init__(self, auth):
        self.auth = auth


class LazyBootstrapIdentityRepository:
    def __init__(self, *, fail_after_bootstrap: bool = False):
        self.profile = None
        self.preferences = None
        self.entitlement = None
        self.fail_after_bootstrap = fail_after_bootstrap

    async def fetch_profile(self, user_id: str, access_token: str):
        return self.profile

    async def fetch_preferences(self, user_id: str, access_token: str):
        return self.preferences

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return self.entitlement

    async def update_profile(self, user_id: str, access_token: str, patch: dict[str, object]):
        if self.profile is None:
            return None
        self.profile.update(patch)
        return dict(self.profile)

    async def update_preferences(self, user_id: str, access_token: str, patch: dict[str, object]):
        if self.preferences is None:
            return None
        patch = {key: value for key, value in patch.items() if key in SUPPORTED_PREFERENCE_PATCH_FIELDS}
        self.preferences.update(patch)
        return dict(self.preferences)

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        self.profile = {"display_name": display_name or "User", "use_case": use_case}
        if not self.fail_after_bootstrap:
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
        return True


class StoredIdentityRepository(LazyBootstrapIdentityRepository):
    def __init__(self):
        super().__init__()
        self.profile = {"display_name": "User One", "use_case": "research"}
        self.preferences = {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
            "sidebar_auto_hide": False,
        }
        self.entitlement = {
            "tier": "standard",
            "status": "active",
            "paid_until": "2099-01-01T00:00:00Z",
            "auto_renew": True,
            "source": "paddle",
        }


class FakeBillingRepository:
    def __init__(self, *, customer=None, subscription=None):
        self.customer_row = customer
        self.subscription_row = subscription

    async def fetch_customer(self, user_id: str):
        return self.customer_row

    async def fetch_subscription(self, user_id: str):
        return self.subscription_row


def _load_app(monkeypatch, *, identity_repo, billing_repo):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(ValidAuth()))

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main
    from app.modules.billing import routes as billing_routes
    from app.modules.identity import routes as identity_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    main = importlib.reload(main)
    identity_routes.service.repository = identity_repo
    billing_routes.service.repository = billing_repo
    return main.app


@pytest.mark.anyio
async def test_me_lazy_bootstraps_missing_canonical_rows(monkeypatch):
    app = _load_app(
        monkeypatch,
        identity_repo=LazyBootstrapIdentityRepository(),
        billing_repo=FakeBillingRepository(),
    )

    async with async_test_client(app) as client:
        response = await client.get("/api/me", headers={"Authorization": "Bearer valid-token"})

    payload = response.json()
    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["data"]["user"]["display_name"] == "User"
    assert payload["data"]["preferences"]["theme"] == "system"
    assert payload["data"]["entitlement"]["tier"] == "free"


@pytest.mark.anyio
async def test_me_fails_when_bootstrap_still_incomplete(monkeypatch):
    app = _load_app(
        monkeypatch,
        identity_repo=LazyBootstrapIdentityRepository(fail_after_bootstrap=True),
        billing_repo=FakeBillingRepository(),
    )

    async with async_test_client(app) as client:
        response = await client.get("/api/me", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "account_bootstrap_failed"


@pytest.mark.anyio
async def test_profile_and_preferences_patch_persist_for_authenticated_user(monkeypatch):
    repo = StoredIdentityRepository()
    app = _load_app(monkeypatch, identity_repo=repo, billing_repo=FakeBillingRepository())

    async with async_test_client(app) as client:
        profile_response = await client.patch(
            "/api/profile",
            headers={"Authorization": "Bearer valid-token"},
            json={"display_name": "Ada Lovelace", "use_case": "writing"},
        )
        preferences_response = await client.patch(
            "/api/preferences",
            headers={"Authorization": "Bearer valid-token"},
            json={"theme": "dark", "editor_density": "compact", "sidebar_collapsed": True, "sidebar_auto_hide": True},
        )

    assert profile_response.status_code == 200
    assert profile_response.json()["data"]["display_name"] == "Ada Lovelace"
    assert preferences_response.status_code == 200
    assert preferences_response.json()["data"]["theme"] == "dark"
    assert preferences_response.json()["data"]["editor_density"] == "compact"
    assert preferences_response.json()["data"]["sidebar_collapsed"] is True
    assert preferences_response.json()["data"]["sidebar_auto_hide"] is True
    assert repo.preferences["sidebar_auto_hide"] is True


@pytest.mark.anyio
async def test_billing_endpoints_return_canonical_empty_models(monkeypatch):
    app = _load_app(
        monkeypatch,
        identity_repo=StoredIdentityRepository(),
        billing_repo=FakeBillingRepository(),
    )

    async with async_test_client(app) as client:
        customer_response = await client.get("/api/billing/customer", headers={"Authorization": "Bearer valid-token"})
        subscription_response = await client.get("/api/billing/subscription", headers={"Authorization": "Bearer valid-token"})

    assert customer_response.status_code == 200
    assert customer_response.json()["data"] == {
        "exists": False,
        "customer_id": None,
        "provider": None,
        "created_at": None,
    }
    assert subscription_response.status_code == 200
    assert subscription_response.json()["data"] == {
        "exists": False,
        "status": "none",
        "plan_code": None,
        "current_period_end": None,
        "cancel_at_period_end": False,
    }


@pytest.mark.anyio
async def test_billing_endpoints_return_active_canonical_models(monkeypatch):
    app = _load_app(
        monkeypatch,
        identity_repo=StoredIdentityRepository(),
        billing_repo=FakeBillingRepository(
            customer={
                "id": "cust-row",
                "provider": "paddle",
                "provider_customer_id": "cus_123",
                "created_at": "2026-03-16T00:00:00Z",
            },
            subscription={
                "id": "sub-row",
                "provider": "paddle",
                "provider_subscription_id": "sub_123",
                "provider_price_id": "price_pro",
                "tier": "pro",
                "status": "active",
                "current_period_end": "2026-04-16T00:00:00Z",
                "cancel_at_period_end": False,
                "payload": {},
            },
        ),
    )

    async with async_test_client(app) as client:
        customer_response = await client.get("/api/billing/customer", headers={"Authorization": "Bearer valid-token"})
        subscription_response = await client.get("/api/billing/subscription", headers={"Authorization": "Bearer valid-token"})

    assert customer_response.json()["data"] == {
        "exists": True,
        "customer_id": "cus_123",
        "provider": "paddle",
        "created_at": "2026-03-16T00:00:00Z",
    }
    assert subscription_response.json()["data"] == {
        "exists": True,
        "status": "active",
        "plan_code": "price_pro",
        "current_period_end": "2026-04-16T00:00:00Z",
        "cancel_at_period_end": False,
    }
