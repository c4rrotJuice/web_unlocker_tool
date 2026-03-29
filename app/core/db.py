from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from app.core.config import get_settings


CANONICAL_MIGRATION_ORDER = (
    "001_extensions_and_utils.sql",
    "002_accounts_and_billing.sql",
    "003_growth_and_unlocks.sql",
    "004_taxonomy.sql",
    "005_sources_citations_quotes.sql",
    "006_notes.sql",
    "007_documents.sql",
    "008_rpc_functions.sql",
    "009_triggers_rls.sql",
)


EXPECTED_TABLES = (
    "user_profiles",
    "user_preferences",
    "user_entitlements",
    "auth_handoff_codes",
    "unlock_events",
    "guest_unlock_usage",
    "bookmarks",
    "user_milestones",
    "projects",
    "tags",
    "sources",
    "citation_instances",
    "citation_renders",
    "citation_templates",
    "quotes",
    "notes",
    "note_sources",
    "note_links",
    "note_tag_links",
    "documents",
    "document_checkpoints",
    "document_citations",
    "document_notes",
    "document_tags",
)


EXPECTED_RPCS = (
    "replace_document_citations_atomic",
    "replace_document_tags_atomic",
    "replace_document_notes_atomic",
    "replace_note_tag_links_atomic",
    "replace_note_sources_atomic",
    "replace_note_links_atomic",
    "get_project_relationship_summaries",
)


@dataclass(frozen=True)
class SchemaContract:
    migration_order: tuple[str, ...]
    tables: set[str]
    rpc_functions: set[str]


_CREATE_TABLE_RE = re.compile(r"create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)", re.IGNORECASE)
_CREATE_FUNCTION_RE = re.compile(r"create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(", re.IGNORECASE)


def migration_pack_dir() -> Path:
    return get_settings().migration_pack_dir


def _read_sql_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_schema_contract() -> SchemaContract:
    pack_dir = migration_pack_dir()
    tables: set[str] = set()
    rpc_functions: set[str] = set()

    for filename in CANONICAL_MIGRATION_ORDER:
        sql_text = _read_sql_file(pack_dir / filename)
        tables.update(match.group(1) for match in _CREATE_TABLE_RE.finditer(sql_text))
        rpc_functions.update(match.group(1) for match in _CREATE_FUNCTION_RE.finditer(sql_text))

    return SchemaContract(
        migration_order=CANONICAL_MIGRATION_ORDER,
        tables=tables,
        rpc_functions=rpc_functions,
    )


def verify_schema_contract() -> tuple[list[str], list[str], list[str]]:
    pack_dir = migration_pack_dir()
    missing_files = [name for name in CANONICAL_MIGRATION_ORDER if not (pack_dir / name).exists()]
    contract = load_schema_contract()
    missing_tables = [name for name in EXPECTED_TABLES if name not in contract.tables]
    missing_rpcs = [name for name in EXPECTED_RPCS if name not in contract.rpc_functions]
    return missing_files, missing_tables, missing_rpcs
