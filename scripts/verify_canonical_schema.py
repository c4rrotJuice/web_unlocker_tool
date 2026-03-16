from __future__ import annotations

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.db import EXPECTED_RPCS, EXPECTED_TABLES, load_schema_contract, verify_schema_contract


def main() -> int:
    missing_files, missing_tables, missing_rpcs = verify_schema_contract()
    if missing_files or missing_tables or missing_rpcs:
        if missing_files:
            print("Missing migration files:")
            for name in missing_files:
                print(f"- {name}")
        if missing_tables:
            print("Missing canonical tables:")
            for name in missing_tables:
                print(f"- {name}")
        if missing_rpcs:
            print("Missing canonical RPCs:")
            for name in missing_rpcs:
                print(f"- {name}")
        return 1

    contract = load_schema_contract()
    print("Canonical migration pack verified.")
    print(f"Ordered files: {len(contract.migration_order)}")
    print(f"Tables verified: {len(EXPECTED_TABLES)}")
    print(f"RPCs verified: {len(EXPECTED_RPCS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
