import importlib

import pytest
import supabase

from app.core.auth import RequestAuthContext
from app.modules.extension.service import ExtensionAccessContext
from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str, email: str = "user@example.com"):
        self.id = user_id
        self.email = email
        self.aud = "authenticated"
        self.role = "authenticated"


class DummyClient:
    def __init__(self, auth):
        self.auth = auth


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1", email=f"{token}@example.com")})


class ValidTokenVerifier:
    def verify(self, token):
        return RequestAuthContext(
            authenticated=True,
            user_id="user-1",
            supabase_subject="user-1",
            email=f"{token}@example.com",
            access_token=token,
            token_claims={"sub": "user-1"},
        )


def _load_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
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
    monkeypatch.setattr(core_auth, "get_token_verifier", lambda: ValidTokenVerifier())
    fake_access = ExtensionAccessContext(
        auth_context=RequestAuthContext(
            authenticated=True,
            user_id="user-1",
            supabase_subject="user-1",
            email="user@example.com",
            access_token="valid",
            token_claims={"sub": "user-1"},
        ),
        account_state=type(
            "AccountState",
            (),
            {
                "profile": type("Profile", (), {"display_name": "User One"})(),
                "entitlement": type("Entitlement", (), {"tier": "standard"})(),
            },
        )(),
        capability_state=type("CapabilityState", (), {"tier": "standard", "capabilities": {"documents": {}, "exports": []}})(),
    )

    async def fake_build_access_context(_request, _auth_context):
        return fake_access

    extension_routes.service.build_access_context = fake_build_access_context
    return main.app, extension_routes


@pytest.mark.anyio
async def test_extension_routes_expose_canonical_bootstrap_handoff_and_seeded_editor_contract(monkeypatch):
    app, extension_routes = _load_app(monkeypatch)

    async def fake_bootstrap(access):
        assert access.user_id == "user-1"
        return {
            "ok": True,
            "data": {
                "profile": {"display_name": "User One"},
                "entitlement": {"tier": "standard"},
                "capabilities": {"tier": "standard", "documents": {}, "exports": []},
                "app": {
                    "origin": "https://app.writior.com",
                    "handoff": {
                        "issue_path": "/api/auth/handoff",
                        "exchange_path": "/api/auth/handoff/exchange",
                        "landing_path": "/auth/handoff",
                        "preferred_destination": "/editor",
                    },
                },
                "taxonomy": {"recent_projects": [], "recent_tags": []},
            },
            "meta": {},
            "error": None,
        }

    async def fake_issue_handoff(_request, _access, payload):
        return {
            "ok": True,
            "data": {
                "code": "handoff-1",
                "redirect_path": payload.redirect_path or "/editor",
                "expires_at": "2099-01-01T00:00:00Z",
            },
            "meta": {},
            "error": None,
        }

    async def fake_exchange_handoff(_request, payload):
        return {
            "ok": True,
            "data": {
                "redirect_path": "/editor",
                "session": {"access_token": "access", "refresh_token": "refresh"},
            },
            "meta": {},
            "error": None,
        }

    async def fake_work_in_editor(_request, _access, payload):
        return {
            "ok": True,
            "data": {
                "document_id": "doc-1",
                "seed": {"document_id": "doc-1", "citation_id": "citation-1", "mode": "quote_focus"},
                "redirect_path": "/editor?document_id=doc-1&seeded=1&seed_citation_id=citation-1&seed_mode=quote_focus",
                "document": {"id": "doc-1"},
                "citation": {"id": "citation-1"},
                "quote": None,
                "note": None,
                "editor_path": "/editor?document_id=doc-1&seeded=1&seed_citation_id=citation-1&seed_mode=quote_focus",
                "editor_url": "/editor?document_id=doc-1&seeded=1&seed_citation_id=citation-1&seed_mode=quote_focus",
            },
            "meta": {},
            "error": None,
        }

    async def fake_usage_event(_request, _access, payload):
        return {"ok": True, "data": {"event": {"event_id": payload.event_id}}, "meta": {}, "error": None}

    extension_routes.service.bootstrap = fake_bootstrap
    extension_routes.service.issue_handoff = fake_issue_handoff
    extension_routes.service.exchange_handoff = fake_exchange_handoff
    extension_routes.service.work_in_editor = fake_work_in_editor
    extension_routes.service.record_usage_event = fake_usage_event

    async with async_test_client(app) as client:
        bootstrap = await client.get("/api/extension/bootstrap", headers={"Authorization": "Bearer valid"})
        issued = await client.post(
            "/api/auth/handoff",
            headers={"Authorization": "Bearer valid"},
            json={"refresh_token": "refresh-1", "redirect_path": "/editor"},
        )
        exchanged = await client.post("/api/auth/handoff/exchange", json={"code": "handoff-1"})
        work = await client.post(
            "/api/extension/work-in-editor",
            headers={"Authorization": "Bearer valid"},
            json={
                "url": "https://example.com/article",
                "selected_text": "Quote",
                "title": "Example article",
                "extraction_payload": {},
            },
        )
        usage = await client.post(
            "/api/extension/usage-events",
            headers={"Authorization": "Bearer valid"},
            json={
                "url": "https://example.com/article",
                "event_id": "123e4567-e89b-42d3-a456-426614174000",
                "event_type": "unlock",
            },
        )

    assert bootstrap.status_code == 200
    assert bootstrap.json()["data"]["app"]["handoff"]["preferred_destination"] == "/editor"
    assert issued.status_code == 200
    assert issued.json()["data"]["code"] == "handoff-1"
    assert exchanged.status_code == 200
    assert exchanged.json()["data"]["session"]["access_token"] == "access"
    assert work.status_code == 200
    assert work.json()["data"]["redirect_path"].startswith("/editor?")
    assert work.json()["data"]["seed"]["document_id"] == "doc-1"
    assert usage.status_code == 200
    assert usage.json()["data"]["event"]["event_id"] == "123e4567-e89b-42d3-a456-426614174000"


@pytest.mark.anyio
async def test_auth_handoff_landing_route_remains_a_thin_web_surface(monkeypatch):
    app, _extension_routes = _load_app(monkeypatch)

    async with async_test_client(app) as client:
        handoff = await client.get("/auth/handoff?code=handoff-1", follow_redirects=False)

    assert handoff.status_code == 200
    assert "Sign-in complete" in handoff.text
    assert "Return to the extension" in handoff.text
