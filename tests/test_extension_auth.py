from pathlib import Path
import re
import subprocess


EXTENSION_ROOT = Path("extension")
UI_LAYER_ROOTS = (
    EXTENSION_ROOT / "popup",
    EXTENSION_ROOT / "sidepanel",
    EXTENSION_ROOT / "content",
)
SENSITIVE_TOKEN_PATTERNS = (
    "access_token",
    "refresh_token",
    "Authorization",
    "Bearer",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _source_files(*roots: Path):
    for root in roots:
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in {".ts", ".js", ".mjs"} and path.name != "bundle.js":
                yield path


def test_extension_ui_layers_do_not_reference_raw_auth_secrets():
    offenders = []
    for path in _source_files(*UI_LAYER_ROOTS):
        source = _read(path)
        for pattern in SENSITIVE_TOKEN_PATTERNS:
            if pattern in source:
                offenders.append(f"{path}:{pattern}")

    assert offenders == []


def test_extension_ui_layers_do_not_make_direct_backend_auth_calls():
    forbidden = re.compile(r"\bfetch\s*\(|\bAPI_ORIGIN\b|\bENDPOINTS\b|\bAuthorization\b|\bBearer\b")
    offenders = [
        str(path)
        for path in _source_files(*UI_LAYER_ROOTS)
        if forbidden.search(_read(path))
    ]

    assert offenders == []


def test_extension_auth_state_storage_is_token_free_and_background_owned():
    auth_state_store = _read(EXTENSION_ROOT / "background" / "auth" / "auth_state_store.ts")
    session_store = _read(EXTENSION_ROOT / "background" / "auth" / "session_store.ts")
    session_manager = _read(EXTENSION_ROOT / "background" / "auth" / "session_manager.ts")

    assert "toPublicAuthState" in auth_state_store
    assert "toPublicAuthState" in session_manager
    assert "STORAGE_KEYS.AUTH_SESSION" in session_store

    storage_local_users = [
        path
        for path in _source_files(EXTENSION_ROOT)
        if "chrome.storage.local" in _read(path)
    ]
    assert set(storage_local_users) <= {
        EXTENSION_ROOT / "background" / "auth" / "auth_state_store.ts",
        EXTENSION_ROOT / "background" / "auth" / "auth_state_store.js",
        EXTENSION_ROOT / "background" / "auth" / "session_store.ts",
        EXTENSION_ROOT / "background" / "auth" / "session_store.js",
    }


def test_extension_auth_node_suite_covers_session_custody_runtime():
    result = subprocess.run(
        ["node", "--test", "tests/extension_phase1_auth.test.mjs"],
        cwd=Path.cwd(),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + "\n" + result.stderr
