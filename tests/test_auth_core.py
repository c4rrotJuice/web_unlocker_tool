import importlib
from types import SimpleNamespace

import pytest
import supabase

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
    def __init__(self):
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
            "status": "grace_period",
            "paid_until": "2099-01-01T00:00:00Z",
            "auto_renew": True,
            "source": "paddle",
        }
        self.bootstrap_calls = 0

    async def fetch_profile(self, user_id: str, access_token: str):
        return self.profile

    async def fetch_preferences(self, user_id: str, access_token: str):
        return self.preferences

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return self.entitlement

    async def update_profile(self, user_id: str, access_token: str, patch: dict[str, object]):
        self.profile.update(patch)
        return dict(self.profile)

    async def update_preferences(self, user_id: str, access_token: str, patch: dict[str, object]):
        self.preferences.update(patch)
        return dict(self.preferences)

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        self.bootstrap_calls += 1
        return True


def _load_main(monkeypatch, *, auth_impl, identity_repo=None):
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
    identity_routes.service.repository = identity_repo or FakeIdentityRepository()
    return main


@pytest.mark.anyio
async def test_protected_route_rejects_missing_bearer(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/me")
        projects_response = await client.get("/api/projects")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "missing_credentials"
    assert projects_response.status_code == 401
    assert projects_response.json()["error"]["code"] == "missing_credentials"


@pytest.mark.anyio
async def test_protected_route_rejects_invalid_and_cookie_only_auth(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=InvalidAuth())
    async with async_test_client(main.app) as client:
        invalid = await client.get("/api/me", headers={"Authorization": "Bearer invalid-token"})
        cookie_only = await client.get("/api/me", headers={"Cookie": "legacy_session=legacy"})

    assert invalid.status_code == 401
    assert invalid.json()["error"]["code"] == "invalid_token"
    assert cookie_only.status_code == 401
    assert cookie_only.json()["error"]["code"] == "missing_credentials"


@pytest.mark.anyio
async def test_protected_route_rejects_expired_token(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ExpiredAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/me", headers={"Authorization": "Bearer expired-token"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "expired_token"


@pytest.mark.anyio
async def test_me_and_entitlements_return_canonical_envelopes(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    headers = {"Authorization": "Bearer valid-token"}
    async with async_test_client(main.app) as client:
        me_response = await client.get("/api/me", headers=headers)
        entitlement_response = await client.get("/api/entitlements/current", headers=headers)
        session_response = await client.post("/api/auth/session", json={"access_token": "valid-token"})
        current_session = await client.get("/api/auth/session")

    me_payload = me_response.json()
    entitlement_payload = entitlement_response.json()
    assert me_response.status_code == 200
    assert me_payload["ok"] is True
    assert me_payload["data"]["user"]["display_name"] == "User One"
    assert me_payload["data"]["preferences"]["theme"] == "system"
    assert me_payload["data"]["entitlement"]["tier"] == "standard"
    assert me_payload["data"]["capabilities"]["bookmarks"] is True
    assert entitlement_response.status_code == 200
    assert entitlement_payload["data"]["entitlement"]["status"] == "grace_period"
    assert entitlement_payload["data"]["capabilities"]["tier"] == "standard"
    assert session_response.status_code == 200
    assert current_session.status_code == 200
    assert current_session.json()["data"]["authenticated"] is True
    assert current_session.json()["data"]["access_token"] == "valid-token"


def test_request_auth_context_contract():
    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="valid-token",
        token_claims={"sub": "user-1"},
        account_state=None,
        capability_state=derive_capability_state(user_id="user-1", tier="free", status="active", paid_until=None),
    )

    assert auth_context.authenticated is True
    assert isinstance(auth_context.user_id, str)
    assert hasattr(auth_context, "token_claims")
    assert hasattr(auth_context, "account_state")
    assert hasattr(auth_context, "capability_state")
