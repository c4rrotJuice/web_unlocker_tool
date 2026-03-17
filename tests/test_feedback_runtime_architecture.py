from pathlib import Path


ROOT = Path(".")
CANONICAL = ROOT / "app/static/js/shared/feedback"
MIRROR = ROOT / "extension/shared/feedback"


def test_feedback_runtime_files_exist():
    expected = {
        "feedback_bus.js",
        "feedback_bus_singleton.js",
        "feedback_tokens.js",
        "status_store.js",
        "toast_renderer.js",
        "toast_system.js",
    }
    assert expected.issubset({path.name for path in CANONICAL.glob("*.js")})


def test_rebuilt_surfaces_import_shared_feedback_runtime_not_legacy_helpers():
    editor_source = Path("app/static/js/editor_v2/core/editor_app.js").read_text(encoding="utf-8")
    shell_boot_source = Path("app/static/js/app_shell/boot.js").read_text(encoding="utf-8")
    research_source = Path("app/static/js/app_shell/pages/research.js").read_text(encoding="utf-8")
    popup_source = Path("extension/popup/index.js").read_text(encoding="utf-8")
    sidepanel_source = Path("extension/sidepanel/index.js").read_text(encoding="utf-8")

    for source in [editor_source, shell_boot_source, research_source, popup_source, sidepanel_source]:
        assert "shared/feedback/feedback_bus_singleton.js" in source
        assert "ui_feedback.js" not in source
        assert "toast_status.js" not in source


def test_status_scopes_are_canonical_and_registered():
    tokens = Path("app/static/js/shared/feedback/feedback_tokens.js").read_text(encoding="utf-8")
    for scope in [
        "editor.document",
        "editor.sync",
        "research.panel",
        "shell.session",
        "shell.handoff",
        "extension.session",
        "extension.sync",
    ]:
        assert scope in tokens


def test_extension_feedback_mirror_matches_canonical_runtime():
    for canonical in sorted(CANONICAL.glob("*.js")):
        mirrored = MIRROR / canonical.name
        assert mirrored.exists(), f"missing mirror file {mirrored}"
        assert canonical.read_text(encoding="utf-8") == mirrored.read_text(encoding="utf-8")


def test_extension_build_profile_syncs_feedback_mirror():
    source = Path("extension/scripts/build_profile.py").read_text(encoding="utf-8")
    assert "sync_feedback_mirror()" in source
    assert 'ROOT / "shared" / "feedback"' in source
