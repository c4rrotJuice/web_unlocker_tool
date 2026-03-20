import json
from pathlib import Path


def test_manifest_keeps_mv3_sidepanel_and_content_entrypoints():
    manifest = json.loads(Path("extension/manifest.json").read_text(encoding="utf-8"))

    assert manifest["manifest_version"] == 3
    assert manifest["background"]["service_worker"] == "background.js"
    assert manifest["side_panel"]["default_path"] == "sidepanel.html"
    assert any(
        item.get("matches") == ["<all_urls>"]
        and item.get("js") == ["content/unlock_content.bundle.js"]
        and item.get("run_at") == "document_idle"
        for item in manifest.get("content_scripts", [])
    )


def test_background_shim_points_to_modular_authority_runtime():
    shim_source = Path("extension/background.js").read_text(encoding="utf-8")
    index_source = Path("extension/background/index.js").read_text(encoding="utf-8")
    router_source = Path("extension/background/router.js").read_text(encoding="utf-8")

    assert 'import "./background/index.js"' in shim_source
    assert "./session_manager.js" in index_source
    assert "./queue_manager.js" in index_source
    assert "./sync_manager.js" in index_source
    assert "./handoff_manager.js" in index_source
    assert "./router.js" in index_source
    assert "MESSAGE_TYPES.CAPTURE_CITATION" in router_source
    assert "MESSAGE_TYPES.WORK_IN_EDITOR" in router_source
    assert "MESSAGE_TYPES.AUTH_RESTORE" in router_source
    assert 'await queueManager.enqueue("usage_event"' in router_source


def test_background_queue_and_sync_preserve_causal_ordering_and_background_auth():
    queue_source = Path("extension/background/queue_manager.js").read_text(encoding="utf-8")
    sync_source = Path("extension/background/sync_manager.js").read_text(encoding="utf-8")
    session_source = Path("extension/background/session_manager.js").read_text(encoding="utf-8")

    assert "dependency.kind === \"citation\"" in queue_source
    assert "dependency.kind === \"quote\"" in queue_source
    assert "status: \"auth_needed\"" in sync_source
    assert "capture_citation" in sync_source
    assert "capture_quote" in sync_source
    assert "capture_note" in sync_source
    assert "usage_event" in sync_source
    assert "getPublicSessionState" in session_source
    assert "summarizeSession" in session_source
    assert "return summarizeSession(merged)" in session_source
    assert "broadcastAuthHydration" in session_source


def test_content_runtime_uses_shadow_root_overlay_and_background_message_bridge():
    bundle_source = Path("extension/content/unlock_content.bundle.js").read_text(encoding="utf-8")
    index_source = Path("extension/content/index.js").read_text(encoding="utf-8")
    overlay_source = Path("extension/content/overlay_root.js").read_text(encoding="utf-8")
    bridge_source = Path("extension/content/runtime_bridge.js").read_text(encoding="utf-8")

    assert "require(\"content/index.js\")" in bundle_source
    assert "import " not in bundle_source
    assert "export " not in bundle_source
    assert "WRITIOR_EXTENSION" in index_source
    assert "bootstrap()" in index_source
    assert "function cleanup()" in index_source
    assert "history.pushState" in index_source
    assert "history.replaceState" in index_source
    assert "MutationObserver" in index_source
    assert "attachShadow" in overlay_source
    assert "writior-root" in overlay_source
    assert "chrome.runtime.sendMessage" in bridge_source


def test_manifest_content_script_points_to_classic_js_not_raw_esm_source():
    manifest = json.loads(Path("extension/manifest.json").read_text(encoding="utf-8"))
    content_scripts = manifest.get("content_scripts", [])
    assert content_scripts, "Expected at least one content_scripts registration."

    for entry in content_scripts:
        for js_path in entry.get("js", []):
            script_source = Path("extension", js_path).read_text(encoding="utf-8")
            assert not any(line.lstrip().startswith("import ") for line in script_source.splitlines())
            assert not any(line.lstrip().startswith("export ") for line in script_source.splitlines())


def test_sidepanel_and_popup_are_modular_summary_clients():
    sidepanel_shim = Path("extension/sidepanel.js").read_text(encoding="utf-8")
    sidepanel_source = Path("extension/sidepanel/index.js").read_text(encoding="utf-8")
    sidepanel_store = Path("extension/sidepanel/store.js").read_text(encoding="utf-8")
    popup_shim = Path("extension/popup.js").read_text(encoding="utf-8")
    popup_source = Path("extension/popup/index.js").read_text(encoding="utf-8")

    assert 'import "./sidepanel/index.js"' in sidepanel_shim
    assert "GET_WORKSPACE_SUMMARY" in sidepanel_store
    assert "Loading compact workspace summary" in sidepanel_source
    assert 'import "./popup/index.js"' in popup_shim
    assert "work-in-editor" in Path("extension/popup.html").read_text(encoding="utf-8")
    assert "createPopupActions" in popup_source
    assert "status-card" in Path("extension/popup.html").read_text(encoding="utf-8")
