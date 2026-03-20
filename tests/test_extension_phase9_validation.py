from pathlib import Path
import json


def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def test_background_is_only_extension_network_authority():
    non_background_sources = [
        _read("extension/content/runtime_bridge.js"),
        _read("extension/content/index.js"),
        _read("extension/content/capture_pill.js"),
        _read("extension/content/note_composer.js"),
        _read("extension/sidepanel/index.js"),
        _read("extension/sidepanel/store.js"),
        _read("extension/popup/index.js"),
        _read("extension/popup/actions.js"),
    ]

    assert "fetch(" in _read("extension/background/api_client.js")
    for source in non_background_sources:
        assert "fetch(" not in source


def test_ui_runtimes_do_not_import_raw_session_storage_or_tokens():
    for path in (
        "extension/content/runtime_bridge.js",
        "extension/content/index.js",
        "extension/sidepanel/store.js",
        "extension/sidepanel/index.js",
        "extension/popup/actions.js",
        "extension/popup/index.js",
    ):
        source = _read(path)
        assert "../auth/session_store.js" not in source
        assert "readRawSession" not in source
        assert "writeRawSession" not in source
        assert "access_token" not in source
        assert "refresh_token" not in source


def test_auth_restore_and_work_in_editor_flows_are_separate():
    handoff = _read("extension/background/handoff_manager.js")
    router = _read("extension/background/router.js")
    api = _read("extension/background/api_client.js")
    content = _read("extension/content/index.js")

    assert "async restoreAuthSession" in handoff
    assert "exchangeHandoff" in handoff
    assert "redirect_path" in handoff
    assert "web_session" in handoff
    assert "async workInEditor" in handoff
    assert "issueHandoff" in handoff
    assert 'case MESSAGE_TYPES.AUTH_RESTORE' in router
    assert 'case MESSAGE_TYPES.WORK_IN_EDITOR' in router
    assert '"/api/auth/handoff/exchange"' in api
    assert '"/api/extension/work-in-editor"' in api
    assert "writior:auth-handoff-request" in content
    assert "writior:auth-handoff-result" in content


def test_logout_and_unauthorized_paths_do_not_clear_unsynced_local_data():
    router = _read("extension/background/router.js")
    session_manager = _read("extension/background/session_manager.js")

    assert 'case MESSAGE_TYPES.LOGOUT' in router
    assert "clearStore(" not in router
    assert "deleteRecord(" not in session_manager
    assert "await writeRawSession(null);" in session_manager


def test_mv3_lifecycle_has_wakeup_and_rehydration_hooks():
    manifest = json.loads(_read("extension/manifest.json"))
    background = _read("extension/background/index.js")

    assert "alarms" in manifest["permissions"]
    assert "runtime.onInstalled.addListener" in background
    assert "runtime.onStartup.addListener" in background
    assert 'export const REPLAY_PERIODIC_ALARM = "writior-sync-replay"' in background
    assert 'export const REPLAY_EXACT_ALARM = "writior-sync-replay-next"' in background
    assert "scheduleReplayAlarm" in background
    assert "alarms?.onAlarm?.addListener" in background
    assert "hydrateAuthorityState()" in background


def test_sidepanel_remains_compact_and_surfaces_local_editor_drafts():
    store = _read("extension/sidepanel/store.js")
    sidepanel = _read("extension/sidepanel/index.js")
    capture_tab = _read("extension/sidepanel/tabs/capture.js")
    summary = _read("extension/background/workspace_summary.js")

    assert "GET_WORKSPACE_SUMMARY" in store
    assert "RESUME_EDITOR_DRAFT" in store
    assert "REMOVE_LOCAL_DRAFT" in store
    assert "chrome.storage?.onChanged?.addListener" in sidepanel
    assert "Offline ·" in sidepanel
    assert "listRecords(\"captures\")" in summary
    assert "listRecords(\"quotes\")" in summary
    assert "drafts:" in summary
    assert "No resumable local drafts." in capture_tab
    assert "Resume in editor" in capture_tab
    assert "Queue debug" in capture_tab


def test_popup_remains_lightweight_and_message_routed_only():
    popup = _read("extension/popup/index.js")
    actions = _read("extension/popup/actions.js")

    assert "renderStatusCard" in popup
    assert "chrome.runtime.sendMessage" in actions
    assert "chrome.storage?.onChanged?.addListener" in popup
    assert "GET_STATUS" in actions
    assert "OPEN_SIDEPANEL" in actions
    assert "GET_WORKSPACE_SUMMARY" not in popup
    assert "notes" not in popup.lower()
    assert "citations" not in popup.lower()


def test_content_cleanup_restores_spa_hooks_and_shadow_root_isolation():
    content = _read("extension/content/index.js")
    overlay = _read("extension/content/overlay_root.js")

    assert "attachShadow" in overlay
    assert "history.pushState = lifecycle.originalPushState;" in content
    assert "history.replaceState = lifecycle.originalReplaceState;" in content
    assert "lifecycle.observer?.disconnect?.();" in content
    assert "overlay.destroy();" in content


def test_logger_redacts_sensitive_session_and_handoff_artifacts():
    source = _read("extension/shared/log.js")

    assert "authorization" in source.lower()
    assert "access_token" in source
    assert "refresh_token" in source
    assert "code" in source
    assert "[redacted]" in source


def test_legacy_entrypoints_are_thin_shims_only():
    assert 'import "./background/index.js";' in _read("extension/background.js")
    assert 'import "./index.js";' in _read("extension/content/unlock_content.js")
    assert 'import "./sidepanel/index.js";' in _read("extension/sidepanel.js")
    assert 'import "./popup/index.js";' in _read("extension/popup.js")


def test_sidepanel_and_popup_delegate_dashboard_or_launch_actions_through_background():
    store = _read("extension/sidepanel/store.js")
    router = _read("extension/background/router.js")
    actions = _read("extension/popup/actions.js")

    assert "MESSAGE_TYPES.OPEN_DASHBOARD" in store
    assert 'case MESSAGE_TYPES.OPEN_DASHBOARD' in router
    assert "OPEN_APP_SIGN_IN" in actions
    assert "WORK_IN_EDITOR" in actions
