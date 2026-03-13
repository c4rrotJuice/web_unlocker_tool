import json
from pathlib import Path


def test_manifest_has_always_active_content_script_and_side_panel():
    manifest = json.loads(Path('extension/manifest.json').read_text())

    content_scripts = manifest.get('content_scripts', [])
    assert any(
        item.get('matches') == ['<all_urls>']
        and item.get('js') == ['content/unlock_content.js']
        and item.get('run_at') == 'document_idle'
        for item in content_scripts
    )

    assert manifest.get('side_panel', {}).get('default_path') == 'sidepanel.html'
    assert 'sidePanel' in manifest.get('permissions', [])


def test_content_script_contains_singleton_root_and_spa_handling_markers():
    source = Path('extension/content/unlock_content.js').read_text()

    assert 'WRITIOR_EXTENSION' in source
    assert 'writior-root' in source
    assert 'bootstrap()' in source
    assert 'function cleanup()' in source

    # SPA route handling markers
    assert 'history.pushState' in source
    assert 'history.replaceState' in source
    assert 'MutationObserver' in source


def test_background_contains_shared_state_sync_and_tier_gating_markers():
    source = Path('extension/background.js').read_text()

    # Shared research state
    assert 'researchState' in source
    assert 'GET_RESEARCH_STATE' in source
    assert 'SET_LAST_SELECTION' in source

    # Background sync queue
    assert 'background_sync_queue' in source
    assert 'flushBackgroundSyncQueue' in source

    # Local-first tier gating
    assert 'tier_cache' in source
    assert 'consumeTierCredit' in source
    assert 'SAVE_CITATION' in source
    assert 'WORK_IN_EDITOR' in source


def test_background_side_panel_toggle_uses_window_id_and_runtime_listeners():
    source = Path('extension/background.js').read_text()

    assert 'async function openSidePanel(tabId, windowId)' in source
    assert 'targetWindowId = Number.isInteger(activeTab?.windowId) ? activeTab.windowId : null;' in source
    assert 'const enablePromise = chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });' in source
    assert 'const openPromise = chrome.sidePanel.open({ windowId: targetWindowId });' in source
    assert 'await Promise.all([enablePromise, openPromise]);' in source

    assert 'chrome.sidePanel?.onPanelOpened?.addListener(() => {' in source
    assert 'chrome.sidePanel?.onPanelClosed?.addListener(() => {' in source
    assert 'const result = await toggleSidePanel(sender.tab?.id || null, sender.tab?.windowId || null);' in source
