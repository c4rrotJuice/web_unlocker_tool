from pathlib import Path
import subprocess


def test_extension_runtime_hardening_node_suite():
    test_files = [
        Path("tests/extension_phase0_runtime.test.mjs"),
        Path("tests/extension_phase2_content.test.mjs"),
        Path("tests/extension_phase6_sidepanel.test.mjs"),
        Path("tests/extension_phase9_hardening.test.mjs"),
        Path("tests/extension_phase11_notes.test.mjs"),
    ]
    result = subprocess.run(
        ["node", "--test", *[str(path) for path in test_files]],
        cwd=Path.cwd(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr
