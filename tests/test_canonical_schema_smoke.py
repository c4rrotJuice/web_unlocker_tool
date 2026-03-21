from pathlib import Path

from app.core.db import CANONICAL_MIGRATION_ORDER, EXPECTED_RPCS, EXPECTED_TABLES, load_schema_contract, verify_schema_contract


def test_canonical_migration_pack_contract_is_complete():
    missing_files, missing_tables, missing_rpcs = verify_schema_contract()
    assert missing_files == []
    assert missing_tables == []
    assert missing_rpcs == []


def test_canonical_migration_order_is_locked():
    contract = load_schema_contract()
    assert contract.migration_order == CANONICAL_MIGRATION_ORDER


def test_expected_tables_and_rpcs_are_present():
    contract = load_schema_contract()
    assert set(EXPECTED_TABLES).issubset(contract.tables)
    assert set(EXPECTED_RPCS).issubset(contract.rpc_functions)


def test_note_sources_canonical_schema_and_rpc_match_runtime_contract():
    notes_migration = Path("writior_migration_pack/006_notes.sql").read_text(encoding="utf-8")
    rpc_migration = Path("writior_migration_pack/008_rpc_functions.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.note_sources" in notes_migration
    assert "source_id uuid references public.sources(id) on delete cascade" in notes_migration
    assert "citation_id uuid references public.citation_instances(id) on delete cascade" in notes_migration
    assert "relation_type text not null default 'external'" in notes_migration
    assert "position integer not null default 0" in notes_migration
    assert "replace_note_sources_atomic" in rpc_migration
    assert "source_id, citation_id, relation_type" in rpc_migration
    assert "'position', ns.position" in rpc_migration


def test_canonical_pack_allows_multiple_citations_per_source():
    citations_migration = Path("writior_migration_pack/005_sources_citations_quotes.sql").read_text(encoding="utf-8")

    assert "create table if not exists public.citation_instances" in citations_migration
    assert "citation_instances_user_id_source_id_key" not in citations_migration


def test_monthly_citation_breakdown_uses_canonical_relation_tables():
    citations_migration = Path("writior_migration_pack/005_sources_citations_quotes.sql").read_text(encoding="utf-8")

    assert "create or replace function public.get_monthly_citation_breakdown" in citations_migration
    assert "public.document_citations" in citations_migration
    assert "public.citation_instances" in citations_migration
    assert "public.citation_renders" in citations_migration
    assert "public.citations" not in citations_migration
