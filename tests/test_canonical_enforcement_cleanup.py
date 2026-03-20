import importlib
from pathlib import Path

import pytest
import supabase


FORBIDDEN_CODE_PATTERNS = (
    "user" + "_meta",
    "unlock_" + "history",
    "ip_" + "usage",
    "wu_" + "access_token",
    "documents" + ".citation_ids",
    "citation_instances" + ".document_id",
    "renders?.mla?.full",
    "payload.full || payload.footnote",
)

FORBIDDEN_ENDPOINT_PATTERNS = (
    '"/api' + '/unlocks"',
    '"/api' + '/bookmarks"',
    '"/api' + '/dashboard/momentum"',
    '"/api' + '/activity/history"',
    '"/api' + '/extension/selection"',
    '"/api' + '/extension/usage-event"',
    '"/api' + '/extension/handoff/issue"',
    '"/api' + '/extension/handoff/exchange"',
    '"/api' + '/citations/by_ids"',
)

ACTIVE_RUNTIME_GLOBS = (
    "app/main.py",
    "app/core/**/*.py",
    "app/modules/**/*.py",
    "app/routes/shell.py",
    "app/static/js/app_shell/**/*.js",
    "app/static/js/editor_v2/**/*.js",
    "app/static/js/shared/**/*.js",
    "app/static/js/auth.js",
    "app/static/js/theme.js",
    "app/static/js/ui_feedback.js",
    "extension/background/**/*.js",
    "extension/content/**/*.js",
    "extension/sidepanel/**/*.js",
    "extension/popup/**/*.js",
    "extension/shared/**/*.js",
    "extension/storage/**/*.js",
    "extension/auth/**/*.js",
    "extension/config.js",
    "extension/manifest.json",
)


class DummyClient:
    def __init__(self):
        self.auth = type("DummyAuth", (), {"get_user": lambda self, token: type("Resp", (), {"user": None})()})()


def _iter_paths():
    current = Path(__file__).resolve()
    seen: set[Path] = set()
    for pattern in ACTIVE_RUNTIME_GLOBS:
        for path in Path(".").glob(pattern):
            if path.is_file():
                seen.add(path)
    for path in Path("tests").glob("test_*.py"):
        if path.is_file():
            resolved = path.resolve()
            if resolved == current:
                continue
            seen.add(path)
    return sorted(seen)


def _iter_sql_paths():
    return sorted(path for path in Path("sql").glob("*.sql") if path.is_file())


def test_forbidden_identifiers_are_absent_from_active_runtime_and_tests():
    offenders: list[str] = []
    for path in _iter_paths():
        text = path.read_text(encoding="utf-8")
        for pattern in FORBIDDEN_CODE_PATTERNS + FORBIDDEN_ENDPOINT_PATTERNS:
            if pattern in text:
                offenders.append(f"{path}:{pattern}")
    assert offenders == []


def test_forbidden_legacy_citation_identifiers_are_absent_from_sql_contracts():
    offenders: list[str] = []
    for path in _iter_sql_paths():
        text = path.read_text(encoding="utf-8")
        for pattern in ("documents" + ".citation_ids", "citation_instances" + ".document_id"):
            if pattern in text:
                offenders.append(f"{path}:{pattern}")
    assert offenders == []


def test_legacy_runtime_files_are_deleted():
    deleted_paths = (
        "app/routes/editor.py",
        "app/routes/extension.py",
        "app/routes/payments.py",
        "app/routes/render.py",
        "app/templates/editor.html",
        "app/templates/dashboard.html",
        "app/static/js/editor.js",
        "app/static/unlock.js",
    )
    for path in deleted_paths:
        assert not Path(path).exists(), path


@pytest.mark.anyio
async def test_only_canonical_routes_are_mounted(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
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
    main = importlib.reload(main)

    mounted = {route.path for route in main.app.routes}

    for forbidden in (
        "/api" + "/unlocks",
        "/api" + "/bookmarks",
        "/api" + "/dashboard/momentum",
        "/api" + "/activity/history",
        "/api" + "/extension/selection",
        "/api" + "/extension/usage-event",
        "/api" + "/extension/handoff/issue",
        "/api" + "/extension/handoff/exchange",
        "/api" + "/citations/by_ids",
    ):
        assert forbidden not in mounted

    for expected in (
        "/auth",
        "/api/auth/handoff",
        "/api/auth/handoff/exchange",
        "/api/activity/unlocks",
        "/api/activity/bookmarks",
        "/api/insights/momentum",
        "/api/reports/monthly",
        "/api/extension/work-in-editor",
        "/api/extension/usage-events",
        "/api/webhooks/paddle",
    ):
        assert expected in mounted
