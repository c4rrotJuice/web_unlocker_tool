import importlib

import pytest
import supabase

from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1", email=f"{token}@example.com")})

    def refresh_session(self, refresh_token):
        session = type(
            "DummySession",
            (),
            {
                "access_token": "refreshed-access",
                "refresh_token": refresh_token,
                "expires_in": 600,
                "token_type": "bearer",
            },
        )()
        return type("DummyRefresh", (), {"session": session})


class DummyClient:
    def __init__(self, auth):
        self.auth = auth


class StoredIdentityRepository:
    async def fetch_profile(self, user_id: str, access_token: str):
        return {"display_name": "User One", "use_case": "research"}

    async def fetch_preferences(self, user_id: str, access_token: str):
        return {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
            "sidebar_auto_hide": False,
        }

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return {
            "tier": "standard",
            "status": "active",
            "paid_until": "2099-01-01T00:00:00Z",
            "auto_renew": True,
            "source": "paddle",
        }

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        return True


def _load_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(ValidAuth()))

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main
    from app.modules.extension import routes as extension_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    extension_routes = importlib.reload(extension_routes)
    main = importlib.reload(main)
    extension_routes.identity_service.repository = StoredIdentityRepository()
    extension_routes.service.identity_service.repository = StoredIdentityRepository()
    return main.app, extension_routes


@pytest.mark.anyio
async def test_extension_contract_uses_canonical_handoff_workflow(monkeypatch):
    app, extension_routes = _load_app(monkeypatch)

    async def fake_issue_handoff(_request, _access, payload):
        return {"ok": True, "data": {"code": "handoff-1", "redirect_path": payload.redirect_path or "/editor"}, "meta": {}, "error": None}

    async def fake_exchange_handoff(_request, payload):
        return {"ok": True, "data": {"redirect_path": "/editor", "session": {"access_token": "access", "refresh_token": "refresh"}}, "meta": {}, "error": None}

    extension_routes.service.issue_handoff = fake_issue_handoff
    extension_routes.service.exchange_handoff = fake_exchange_handoff

    async with async_test_client(app) as client:
        issued = await client.post(
            "/api/auth/handoff",
            headers={"Authorization": "Bearer valid"},
            json={"refresh_token": "refresh-1", "redirect_path": "/editor"},
        )
        exchanged = await client.post("/api/auth/handoff/exchange", json={"code": "handoff-1"})

    assert issued.status_code == 200
    assert issued.json()["data"]["code"] == "handoff-1"
    assert exchanged.status_code == 200
    assert exchanged.json()["data"]["session"]["access_token"] == "access"


@pytest.mark.anyio
async def test_extension_contract_supports_attempt_create_complete_and_status(monkeypatch):
    app, extension_routes = _load_app(monkeypatch)

    async def fake_create_attempt(_request, payload):
        return {
            "ok": True,
            "data": {
                "attempt_id": "attempt-1",
                "attempt_token": "token-1",
                "status": "pending",
                "redirect_path": payload.redirect_path or "/dashboard",
                "expires_at": "2099-01-01T00:00:00Z",
            },
            "meta": {},
            "error": None,
        }

    async def fake_complete_attempt(_request, *, attempt_id, auth_context, payload):
        assert auth_context.user_id == "user-1"
        return {
            "ok": True,
            "data": {
                "attempt_id": attempt_id,
                "status": "ready",
                "redirect_path": payload.redirect_path or "/dashboard",
            },
            "meta": {},
            "error": None,
        }

    async def fake_attempt_status(_request, *, attempt_id, attempt_token):
        assert attempt_token == "token-1"
        return {
            "ok": True,
            "data": {
                "attempt_id": attempt_id,
                "status": "ready",
                "exchange": {"code": "handoff-1", "exchange_path": "/api/auth/handoff/exchange"},
            },
            "meta": {},
            "error": None,
        }

    extension_routes.service.create_auth_attempt = fake_create_attempt
    extension_routes.service.complete_auth_attempt = fake_complete_attempt
    extension_routes.service.auth_attempt_status = fake_attempt_status

    async with async_test_client(app) as client:
        created = await client.post("/api/auth/handoff/attempts", json={"redirect_path": "/dashboard"})
        completed = await client.post(
            "/api/auth/handoff/attempts/attempt-1/complete",
            headers={"Authorization": "Bearer valid"},
            json={"refresh_token": "refresh-1", "redirect_path": "/dashboard"},
        )
        status = await client.get("/api/auth/handoff/attempts/attempt-1", headers={"X-Auth-Attempt-Token": "token-1"})

    assert created.status_code == 200
    assert created.json()["data"]["attempt_id"] == "attempt-1"
    assert completed.status_code == 200
    assert completed.json()["data"]["status"] == "ready"
    assert status.status_code == 200
    assert status.json()["data"]["exchange"]["code"] == "handoff-1"


@pytest.mark.anyio
async def test_extension_work_in_editor_and_usage_event_use_canonical_endpoints(monkeypatch):
    app, extension_routes = _load_app(monkeypatch)

    async def fake_work_in_editor(_request, _access, payload):
        return {
            "ok": True,
            "data": {
                "document_id": "doc-1",
                "redirect_path": "/editor?document_id=doc-1&seeded=1",
                "seed": {"document_id": "doc-1", "citation_id": "citation-1", "mode": "seed_review"},
            },
            "meta": {},
            "error": None,
        }

    async def fake_usage_event(_request, _access, payload):
        return {"ok": True, "data": {"event": {"event_id": payload.event_id}}, "meta": {}, "error": None}

    extension_routes.service.work_in_editor = fake_work_in_editor
    extension_routes.service.record_usage_event = fake_usage_event

    async with async_test_client(app) as client:
        work = await client.post(
            "/api/extension/work-in-editor",
            headers={"Authorization": "Bearer valid"},
            json={"url": "https://example.com/article", "selected_text": "Quote", "title": "Example"},
        )
        usage = await client.post(
            "/api/extension/usage-events",
            headers={"Authorization": "Bearer valid"},
            json={"url": "https://example.com/article", "event_id": "123e4567-e89b-42d3-a456-426614174000", "event_type": "unlock"},
        )

    assert work.status_code == 200
    assert work.json()["data"]["redirect_path"].startswith("/editor?")
    assert usage.status_code == 200
    assert usage.json()["data"]["event"]["event_id"] == "123e4567-e89b-42d3-a456-426614174000"


@pytest.mark.anyio
async def test_removed_extension_aliases_return_404(monkeypatch):
    app, _extension_routes = _load_app(monkeypatch)

    async with async_test_client(app) as client:
        responses = [
            await client.post("/api/extension" + "/handoff/issue", json={"refresh_token": "refresh-1", "redirect_path": "/editor"}, headers={"Authorization": "Bearer valid"}),
            await client.post("/api/extension" + "/handoff/exchange", json={"code": "handoff-1"}),
            await client.post("/api/extension" + "/selection", json={"url": "https://example.com/article"}, headers={"Authorization": "Bearer valid"}),
            await client.post("/api/extension" + "/usage-event", json={"url": "https://example.com/article", "event_id": "123e4567-e89b-42d3-a456-426614174000", "event_type": "unlock"}, headers={"Authorization": "Bearer valid"}),
        ]

    assert all(response.status_code == 404 for response in responses)
