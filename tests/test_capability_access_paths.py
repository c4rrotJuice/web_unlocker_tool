from __future__ import annotations

import pytest
from starlette.requests import Request

from app.core.account_state import AccountState, UserEntitlement, UserPreferences, UserProfile
from app.core.auth import RequestAuthContext
from app.core.entitlements import capability_state_from_account_state, derive_capability_state
from app.modules.research.common import load_capability_state_from_request
from app.modules.research import routes as research_routes
from app.modules.workspace import routes as workspace_routes
from tests.conftest import async_test_client
from tests.test_auth_core import ValidAuth, _load_main


def _request_scope(path: str = "/api/editor/access") -> dict[str, object]:
    return {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "query_string": b"",
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
        "scheme": "http",
    }


def _canonical_account_state(*, tier: str = "standard", status: str = "active") -> AccountState:
    entitlement = UserEntitlement(
        tier=tier,
        status=status,
        paid_until="2099-01-01T00:00:00Z",
        auto_renew=True,
        source="paddle",
    )
    return AccountState(
        profile=UserProfile(user_id="user-1", display_name="Ada Lovelace", use_case="research"),
        preferences=UserPreferences(),
        entitlement=entitlement,
        billing_customer=None,
        billing_subscription=None,
    )


def _auth_context() -> RequestAuthContext:
    return RequestAuthContext(
        authenticated=True,
        user_id="user-1",
        supabase_subject="user-1",
        email="user@example.com",
        access_token="token",
        token_claims={"sub": "user-1"},
    )


class FakeIdentityService:
    def __init__(self, account_state: AccountState):
        self.account_state = account_state
        self.calls = 0

    async def resolve_access_state(self, auth_context: RequestAuthContext):
        del auth_context
        self.calls += 1
        capability_state = capability_state_from_account_state(self.account_state)
        return self.account_state, capability_state


@pytest.mark.anyio
async def test_shared_loader_ignores_request_state_fallbacks():
    account_state = _canonical_account_state()
    identity_service = FakeIdentityService(account_state)
    request = Request(_request_scope())
    request.state.account_type = "free"
    request.state.capability_state = derive_capability_state(
        user_id="user-1",
        tier="free",
        status="active",
        paid_until=None,
    )

    access = await load_capability_state_from_request(
        request,
        _auth_context(),
        identity_service=identity_service,
    )

    assert identity_service.calls == 1
    assert access.capability_state.tier == "standard"
    assert access.capability_state.capabilities["bookmarks"] is True
    assert request.state.capability_state.tier == "standard"
    assert request.state.auth_context.account_state.entitlement.tier == "standard"
    assert request.state.auth_context.capability_state.tier == "standard"


@pytest.mark.anyio
async def test_workspace_and_research_access_helpers_use_same_canonical_shape(monkeypatch):
    account_state = _canonical_account_state(tier="pro")
    identity_service = FakeIdentityService(account_state)
    monkeypatch.setattr(workspace_routes, "identity_service", identity_service)
    monkeypatch.setattr(research_routes, "identity_service", identity_service)

    request = Request(_request_scope("/api/projects"))
    auth_context = _auth_context()

    workspace_access = await workspace_routes._access(request, auth_context=auth_context)
    research_access = await research_routes._access(request, auth_context=auth_context)

    assert workspace_access == research_access
    assert workspace_access.capability_state.tier == "pro"
    assert workspace_access.capability_state.capabilities["zip_export"] is True
    assert workspace_access.capability_state.capabilities["bookmarks"] is True


@pytest.mark.anyio
async def test_editor_access_response_uses_canonical_capabilities(monkeypatch):
    account_state = _canonical_account_state(tier="standard")
    identity_service = FakeIdentityService(account_state)
    monkeypatch.setattr(workspace_routes, "identity_service", identity_service)

    request = Request(_request_scope())
    access = await workspace_routes._access(request, auth_context=_auth_context())
    response = await workspace_routes.editor_access(access=access)

    assert response["ok"] is True
    assert response["data"]["capabilities"] == access.capability_state.capabilities
    assert response["data"]["capabilities"]["bookmarks"] is True
    assert response["data"]["capabilities"]["zip_export"] is False


@pytest.mark.anyio
async def test_editor_access_rejects_missing_bearer(monkeypatch):
    main = _load_main(monkeypatch, auth_impl=ValidAuth())
    async with async_test_client(main.app) as client:
        response = await client.get("/api/editor/access")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "missing_credentials"
