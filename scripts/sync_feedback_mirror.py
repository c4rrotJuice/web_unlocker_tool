#!/usr/bin/env python3
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "app" / "static" / "js" / "shared" / "feedback"
MIRROR = ROOT / "extension" / "shared" / "feedback"


def main() -> int:
    if not CANONICAL.exists():
        print(f"Missing canonical feedback directory: {CANONICAL}", file=sys.stderr)
        return 1
    MIRROR.mkdir(parents=True, exist_ok=True)
    for path in sorted(CANONICAL.glob("*.js")):
        shutil.copyfile(path, MIRROR / path.name)
    print(f"Synced feedback mirror: {CANONICAL} -> {MIRROR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
