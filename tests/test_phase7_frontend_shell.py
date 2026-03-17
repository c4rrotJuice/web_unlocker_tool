import importlib
import re

import pytest
import supabase

from tests.conftest import async_test_client


class DummyAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": None})


class DummyClient:
    def __init__(self):
        self.auth = DummyAuth()


def _load_main(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")

    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    return importlib.reload(main)


@pytest.mark.anyio
async def test_public_config_exposes_canonical_boot_keys(monkeypatch):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.get("/api/public-config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["supabase_url"] == "http://example.com"
    assert payload["supabase_anon_key"] == "anon"
    assert payload["canonical_app_origin"] == "https://app.writior.com"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "title_fragment", "page_id"),
    [
        ("/dashboard", "Dashboard", "dashboard"),
        ("/projects", "Projects", "projects"),
        ("/projects/project-123", "Project", "projects"),
        ("/research?tab=quotes&selected=quote-1", "Research Explorer", "research"),
        ("/editor", "Documents", "editor"),
        ("/insights", "Insights", "insights"),
    ],
)
async def test_shell_routes_render_minimal_boot_metadata(monkeypatch, path, title_fragment, page_id):
    main = _load_main(monkeypatch)
    async with async_test_client(main.app) as client:
        response = await client.get(path)

    assert response.status_code == 200
    html = response.text
    assert f"<title>{title_fragment} · Writior</title>" in html
    assert 'id="app-boot"' in html
    assert f'"page": "{page_id}"' in html
    assert "/static/js/app_shell/boot.js" in html
    assert "citation-history" not in html


def test_shell_boot_payload_does_not_embed_entity_collections():
    template = open("app/templates/app_shell_base.html", encoding="utf-8").read()
    assert "recent_documents" not in template
    assert "recent_research" not in template
    assert re.search(r'<script id="app-boot" type="application/json">', template)


def test_research_shell_uses_separate_card_and_detail_renderers():
    boot_source = open("app/static/js/app_shell/pages/research.js", encoding="utf-8").read()
    card_source = open("app/static/js/app_shell/renderers/cards.js", encoding="utf-8").read()
    detail_source = open("app/static/js/app_shell/renderers/details.js", encoding="utf-8").read()

    assert 'from "../renderers/cards.js"' in boot_source
    assert 'from "../renderers/details.js"' in boot_source
    assert "renderSourceCard" in card_source
    assert "renderSourceDetail" in detail_source


def test_phase7_runtime_avoids_legacy_cookie_and_dashboard_fetch_paths():
    auth_source = open("app/static/js/auth.js", encoding="utf-8").read()
    dashboard_source = open("app/static/js/app_shell/pages/dashboard.js", encoding="utf-8").read()

    assert "WRITIOR_SUPABASE_URL" in auth_source
    assert "/api/insights/monthly-summary" in dashboard_source


def test_projects_surface_requests_explicit_limited_project_list():
    source = open("app/static/js/app_shell/pages/projects.js", encoding="utf-8").read()
    assert "/api/projects?include_archived=false&limit=24" in source


def test_research_selection_does_not_force_list_refetch_on_same_dataset():
    source = open("app/static/js/app_shell/pages/research.js", encoding="utf-8").read()
    assert "function selectItem(id)" in source
    assert "refreshListSelection();" in source
    assert "loadDetail(id);" in source
    assert "updateResearchUrl({ selected: id });\n    refreshListSelection();\n    loadDetail(id);" in source
    assert "updateResearchUrl({ selected: \"\" });\n    clearContext();\n    refreshListSelection();" in source


def test_research_popstate_reuses_current_list_when_only_selection_changes():
    source = open("app/static/js/app_shell/pages/research.js", encoding="utf-8").read()
    assert "if (datasetKey(state) === activeDatasetKey && latestListItems.length)" in source
    assert "loadList();" in source


def test_research_tablist_has_keyboard_navigation_hooks():
    template = open("app/templates/app_research.html", encoding="utf-8").read()
    source = open("app/static/js/app_shell/pages/research.js", encoding="utf-8").read()
    assert 'role="tablist"' in template
    assert 'aria-controls="research-list-region"' in template
    assert 'event.key === "ArrowRight"' in source
    assert 'event.key === "ArrowLeft"' in source
    assert 'event.key === "Home"' in source
    assert 'event.key === "End"' in source


def test_projects_api_supports_explicit_limit_parameter():
    route_source = open("app/modules/research/routes.py", encoding="utf-8").read()
    service_source = open("app/modules/research/taxonomy/service.py", encoding="utf-8").read()
    repo_source = open("app/modules/research/taxonomy/repo.py", encoding="utf-8").read()
    assert "limit: int = Query(default=24, le=100)" in route_source
    assert "limit=limit" in service_source
    assert '"limit": str(limit)' in repo_source
