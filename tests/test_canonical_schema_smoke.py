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
