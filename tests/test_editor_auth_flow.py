from types import SimpleNamespace

import pytest

from app.routes import editor


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def request_factory():
    def _build(user_id=None, account_type=None):
        return SimpleNamespace(state=SimpleNamespace(user_id=user_id, account_type=account_type))

    return _build


@pytest.mark.anyio
async def test_editor_page_renders_without_server_side_auth_redirect(request_factory):
    request = request_factory(user_id=None, account_type=None)

    response = await editor.editor_page(request)

    assert response.status_code == 200
    assert response.template.name == "editor.html"


@pytest.mark.anyio
async def test_editor_access_requires_authentication(request_factory):
    request = request_factory(user_id=None, account_type=None)

    with pytest.raises(editor.HTTPException) as exc:
        await editor.editor_access(request)

    assert exc.value.status_code == 401


@pytest.mark.anyio
async def test_editor_access_reports_paid_flag_for_paid_user(request_factory):
    request = request_factory(user_id="user-123", account_type="pro")

    payload = await editor.editor_access(request)

    assert payload == {"account_type": "pro", "is_paid": True}


@pytest.mark.anyio
async def test_editor_access_reports_paid_flag_for_free_user(request_factory):
    request = request_factory(user_id="user-123", account_type="free")

    payload = await editor.editor_access(request)

    assert payload == {"account_type": "free", "is_paid": False}
