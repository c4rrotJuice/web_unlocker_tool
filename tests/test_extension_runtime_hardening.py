from pathlib import Path
import subprocess


def test_extension_runtime_hardening_node_suite():
    test_files = sorted(Path("tests/extension_runtime").glob("*.test.mjs"))
    result = subprocess.run(
        ["node", "--test", *[str(path) for path in test_files]],
        cwd=Path.cwd(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr
