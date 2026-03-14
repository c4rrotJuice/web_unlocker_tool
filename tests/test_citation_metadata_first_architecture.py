from pathlib import Path


def test_backend_exposes_metadata_first_render_endpoint_and_render_cache_payload():
    source = Path("app/routes/citations.py").read_text(encoding="utf-8")

    assert "@router.post(\"/api/citations/render\")" in source
    assert "citation_instances" in source
    assert "citation_renders" in source
    assert "source_fingerprint" in source
    assert "source_version" in source


def test_clients_delegate_standard_rendering_to_backend():
    extension_source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")
    webapp_source = Path("app/static/unlock.js").read_text(encoding="utf-8")

    assert 'sendMessage("RENDER_CITATION"' in extension_source
    assert "fetch('/api/citations/render'" in webapp_source


def test_sql_schema_supports_source_identity_and_render_cache():
    migration = Path("sql/20260315_refactor_citations_to_metadata_first.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.sources" in migration
    assert "create table if not exists public.citation_instances" in migration
    assert "create table if not exists public.citation_renders" in migration
