import asyncio
import importlib
from types import SimpleNamespace

import pytest
import supabase

from app.core.auth import RequestAuthContext


class DummySupabaseAuth:
    def __init__(self):
        self.created_users = []

    def sign_up(self, payload):
        user = SimpleNamespace(id="signup-user", email=payload["email"])
        self.created_users.append(user)
        return SimpleNamespace(user=user)


class DummySupabaseClient:
    def __init__(self):
        self.auth = DummySupabaseAuth()


class FakeBootstrapRepository:
    def __init__(self):
        self.rows = {
            "profiles": {},
            "preferences": {},
            "entitlements": {},
        }
        self.bootstrap_calls = 0

    async def fetch_profile(self, user_id: str, access_token: str):
        return self.rows["profiles"].get(user_id)

    async def fetch_preferences(self, user_id: str, access_token: str):
        return self.rows["preferences"].get(user_id)

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return self.rows["entitlements"].get(user_id)

    async def update_profile(self, user_id: str, access_token: str, patch: dict[str, object]):
        row = self.rows["profiles"].get(user_id)
        if row is None:
            return None
        row.update(patch)
        return dict(row)

    async def update_preferences(self, user_id: str, access_token: str, patch: dict[str, object]):
        row = self.rows["preferences"].get(user_id)
        if row is None:
            return None
        row.update(patch)
        return dict(row)

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        self.bootstrap_calls += 1
        self.rows["profiles"].setdefault(
            user_id,
            {"display_name": display_name or "User", "use_case": use_case},
        )
        self.rows["preferences"].setdefault(
            user_id,
            {
                "theme": "system",
                "editor_density": "comfortable",
                "default_citation_style": "apa",
                "sidebar_collapsed": False,
                "sidebar_auto_hide": False,
            },
        )
        self.rows["entitlements"].setdefault(
            user_id,
            {
                "tier": "free",
                "status": "active",
                "paid_until": None,
                "auto_renew": False,
                "source": "system",
            },
        )
        return True


class FakeBootstrapFailureRepository(FakeBootstrapRepository):
    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        self.bootstrap_calls += 1
        self.rows["profiles"].setdefault(
            user_id,
            {"display_name": display_name or "User", "use_case": use_case},
        )
        return True


def _load_identity(monkeypatch, repository):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummySupabaseClient())

    import app.core.config as core_config
    from app.modules.identity import routes as identity_routes
    from app.modules.identity.schemas import SignupRequest

    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    identity_routes.service.repository = repository
    identity_routes.supabase_admin = DummySupabaseClient()
    return identity_routes, SignupRequest


@pytest.mark.anyio
async def test_signup_bootstraps_all_canonical_account_rows(monkeypatch):
    identity_routes, SignupRequest = _load_identity(monkeypatch, FakeBootstrapRepository())

    payload = SignupRequest(
        email="ada@example.com",
        password="test-password",
        display_name="Ada Lovelace",
        use_case="research",
    )

    response = await identity_routes.signup(payload)

    assert response["ok"] is True
    assert response["data"]["user_id"] == "signup-user"
    assert response["data"]["bootstrap_completed"] is True
    repo = identity_routes.service.repository
    assert "signup-user" in repo.rows["profiles"]
    assert "signup-user" in repo.rows["preferences"]
    assert "signup-user" in repo.rows["entitlements"]


@pytest.mark.anyio
async def test_repeat_bootstrap_is_idempotent(monkeypatch):
    identity_routes, _ = _load_identity(monkeypatch, FakeBootstrapRepository())
    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="token",
        token_claims={"sub": "user-1"},
    )

    first = await identity_routes.service.ensure_account_bootstrapped(auth_context, display_name="Ada", use_case="research")
    second = await identity_routes.service.ensure_account_bootstrapped(auth_context, display_name="Ada", use_case="research")

    repo = identity_routes.service.repository
    assert first.profile.display_name == "Ada"
    assert second.profile.display_name == "Ada"
    assert len(repo.rows["profiles"]) == 1
    assert len(repo.rows["preferences"]) == 1
    assert len(repo.rows["entitlements"]) == 1


@pytest.mark.anyio
async def test_incomplete_bootstrap_fails_after_recovery_attempt(monkeypatch):
    identity_routes, _ = _load_identity(monkeypatch, FakeBootstrapFailureRepository())
    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="token",
        token_claims={"sub": "user-1"},
    )

    with pytest.raises(Exception) as exc_info:
        await identity_routes.service.me(auth_context)

    assert getattr(exc_info.value, "code", None) == "account_bootstrap_failed"


@pytest.mark.anyio
async def test_concurrent_bootstrap_calls_converge_to_single_account_state(monkeypatch):
    identity_routes, _ = _load_identity(monkeypatch, FakeBootstrapRepository())
    auth_context = RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="token",
        token_claims={"sub": "user-1"},
    )

    results = await asyncio.gather(
        identity_routes.service.ensure_account_bootstrapped(auth_context, display_name="Ada", use_case="research"),
        identity_routes.service.ensure_account_bootstrapped(auth_context, display_name="Ada", use_case="research"),
        identity_routes.service.ensure_account_bootstrapped(auth_context, display_name="Ada", use_case="research"),
    )

    repo = identity_routes.service.repository
    assert all(result.profile.display_name == "Ada" for result in results)
    assert len(repo.rows["profiles"]) == 1
    assert len(repo.rows["preferences"]) == 1
    assert len(repo.rows["entitlements"]) == 1
