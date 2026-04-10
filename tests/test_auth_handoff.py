from types import SimpleNamespace

import pytest

from app.core.auth import RequestAuthContext
from app.modules.extension.schemas import HandoffRefreshRequest
from app.modules.extension.service import ExtensionAccessContext
from tests.test_extension_auth_attempt_service import _request, _service


def _access(access_token: str | None = "access-token") -> ExtensionAccessContext:
    return ExtensionAccessContext(
        auth_context=RequestAuthContext(
            authenticated=True,
            user_id="user-1",
            supabase_subject="user-1",
            email="user@example.com",
            access_token=access_token,
            token_claims={"sub": "user-1"},
        ),
        account_state=SimpleNamespace(profile=SimpleNamespace(), entitlement=SimpleNamespace()),
        capability_state=SimpleNamespace(tier="standard"),
    )


class RevokingAuthClient:
    def __init__(self):
        self.revoked = []
        self.auth = SimpleNamespace(admin=SimpleNamespace(sign_out=self.sign_out))

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        self.revoked.append({"jwt": jwt, "scope": scope})


class RefreshRevokingAuthClient:
    def __init__(self):
        self.revoked = False
        self.auth = SimpleNamespace(
            admin=SimpleNamespace(sign_out=self.sign_out),
            get_user=self.get_user,
            refresh_session=self.refresh_session,
        )

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        self.revoked = True

    def get_user(self, token: str):
        return SimpleNamespace(user=SimpleNamespace(id="user-1")) if token else SimpleNamespace(user=None)

    def refresh_session(self, refresh_token: str):
        if self.revoked:
            raise RuntimeError("refresh token revoked")
        return SimpleNamespace(
            session=SimpleNamespace(
                access_token="new-access",
                refresh_token=refresh_token,
                expires_in=300,
                token_type="bearer",
            )
        )


class FailingRevokingAuthClient:
    def __init__(self):
        self.auth = SimpleNamespace(admin=SimpleNamespace(sign_out=self.sign_out))

    def sign_out(self, jwt: str, scope: str = "global") -> None:
        raise RuntimeError("provider unavailable")


@pytest.mark.anyio
async def test_extension_handoff_logout_revokes_supabase_session_globally():
    service = _service()
    auth_client = RevokingAuthClient()
    service._auth_client = auth_client

    result = await service.revoke_session(_request(), _access())

    assert result["ok"] is True
    assert result["data"] == {"revoked": True, "scope": "global"}
    assert auth_client.revoked == [{"jwt": "access-token", "scope": "global"}]


@pytest.mark.anyio
async def test_extension_handoff_logout_reports_provider_revocation_failure():
    service = _service()
    service._auth_client = FailingRevokingAuthClient()

    with pytest.raises(Exception) as exc:
        await service.revoke_session(_request(), _access())

    assert getattr(exc.value, "code", "") == "handoff_logout_failed"


@pytest.mark.anyio
async def test_extension_handoff_logout_requires_authenticated_access_token():
    service = _service()
    service._auth_client = RevokingAuthClient()

    with pytest.raises(Exception) as exc:
        await service.revoke_session(_request(), _access(access_token=None))

    assert getattr(exc.value, "code", "") == "handoff_logout_failed"


@pytest.mark.anyio
async def test_extension_handoff_refresh_token_reuse_fails_after_logout_revocation():
    service = _service()
    service._auth_client = RefreshRevokingAuthClient()
    request = _request()

    before_logout = await service.refresh_session(request, HandoffRefreshRequest(refresh_token="refresh-token"))
    assert before_logout["ok"] is True

    await service.revoke_session(request, _access())

    with pytest.raises(Exception) as exc:
        await service.refresh_session(request, HandoffRefreshRequest(refresh_token="refresh-token"))

    assert getattr(exc.value, "code", "") == "handoff_refresh_failed"
