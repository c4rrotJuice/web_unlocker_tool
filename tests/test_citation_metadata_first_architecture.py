from pathlib import Path

import pytest


def test_backend_exposes_metadata_first_render_endpoint_and_render_cache_payload():
    source = Path("app/modules/research/routes.py").read_text(encoding="utf-8")
    service_source = Path("app/modules/research/citations/service.py").read_text(encoding="utf-8")
    repo_source = Path("app/modules/research/citations/repo.py").read_text(encoding="utf-8")
    domain_source = Path("app/services/citation_domain.py").read_text(encoding="utf-8")
    sources_service = Path("app/modules/research/sources/service.py").read_text(encoding="utf-8")

    assert "@router.post(\"/api/citations/render\")" in source
    assert "@router.post(\"/api/citations/by-ids\")" in source
    assert "citation_renders" in repo_source
    assert "source_version" in source or "source_version" in service_source
    assert "citation_version" in service_source
    assert "legacy_metadata_to_payload" not in domain_source
    assert "legacy_metadata_to_payload" not in sources_service


def test_extension_capture_runtime_delegates_network_to_background_router():
    content_bridge_path = Path("extension/content/runtime_bridge.js")
    background_router_path = Path("extension/background/router.js")
    if not content_bridge_path.exists() or not background_router_path.exists():
        pytest.skip("Extension runtime sources are not present in this checkout")

    content_bridge = content_bridge_path.read_text(encoding="utf-8")
    background_router = background_router_path.read_text(encoding="utf-8")

    assert "chrome.runtime.sendMessage" in content_bridge
    assert "MESSAGE_TYPES.CAPTURE_CITATION" in background_router
    assert "MESSAGE_TYPES.CAPTURE_QUOTE" in background_router
    assert "MESSAGE_TYPES.CAPTURE_NOTE" in background_router
    assert "MESSAGE_TYPES.WORK_IN_EDITOR" in background_router


def test_canonical_sql_schema_supports_source_identity_and_non_lossy_citation_instances():
    migration = Path("writior_migration_pack/005_sources_citations_quotes.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.sources" in migration
    assert "create table if not exists public.citation_instances" in migration
    assert "create table if not exists public.citation_renders" in migration
    assert "citation_instances_user_id_source_id_key" not in migration


def test_rls_migration_secures_metadata_first_tables_and_note_links():
    migration = Path("sql/20260316_secure_metadata_first_citation_tables.sql").read_text(encoding="utf-8")

    assert "alter table public.sources enable row level security;" in migration
    assert "alter table public.citation_instances enable row level security;" in migration
    assert "alter table public.citation_renders enable row level security;" in migration
    assert "references public.citation_instances(id)" in migration
