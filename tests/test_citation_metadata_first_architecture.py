from pathlib import Path


def test_backend_exposes_metadata_first_render_endpoint_and_render_cache_payload():
    source = Path("app/modules/research/routes.py").read_text(encoding="utf-8")
    service_source = Path("app/modules/research/citations/service.py").read_text(encoding="utf-8")
    repo_source = Path("app/modules/research/citations/repo.py").read_text(encoding="utf-8")

    assert "@router.post(\"/api/citations/render\")" in source
    assert "@router.post(\"/api/citations/by-ids\")" in source
    assert "citation_renders" in repo_source
    assert "source_version" in source or "source_version" in service_source
    assert "citation_version" in service_source


def test_extension_capture_runtime_delegates_network_to_background_router():
    content_bridge = Path("extension/content/runtime_bridge.js").read_text(encoding="utf-8")
    background_router = Path("extension/background/router.js").read_text(encoding="utf-8")

    assert "chrome.runtime.sendMessage" in content_bridge
    assert "MESSAGE_TYPES.CAPTURE_CITATION" in background_router
    assert "MESSAGE_TYPES.CAPTURE_QUOTE" in background_router
    assert "MESSAGE_TYPES.CAPTURE_NOTE" in background_router
    assert "MESSAGE_TYPES.WORK_IN_EDITOR" in background_router


def test_sql_schema_supports_source_identity_and_render_cache():
    migration = Path("sql/20260315_refactor_citations_to_metadata_first.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.sources" in migration
    assert "create table if not exists public.citation_instances" in migration
    assert "create table if not exists public.citation_renders" in migration


def test_rls_migration_secures_metadata_first_tables_and_note_links():
    migration = Path("sql/20260316_secure_metadata_first_citation_tables.sql").read_text(encoding="utf-8")

    assert "alter table public.sources enable row level security;" in migration
    assert "alter table public.citation_instances enable row level security;" in migration
    assert "alter table public.citation_renders enable row level security;" in migration
    assert "references public.citation_instances(id)" in migration
