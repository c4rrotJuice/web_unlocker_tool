from pathlib import Path


def test_editor_shell_route_uses_v2_template_and_runtime():
    route_source = Path("app/routes/shell.py").read_text(encoding="utf-8")
    template_source = Path("app/templates/app_editor.html").read_text(encoding="utf-8")
    boot_source = Path("app/static/js/app_shell/pages/editor.js").read_text(encoding="utf-8")

    assert '"app_editor.html"' in route_source
    assert "/static/css/editor_v2.css" in template_source
    assert "editor-v2-shell" in template_source
    assert "createEditorApp" in boot_source
    assert "editor_v2/core/editor_app.js" in boot_source


def test_editor_runtime_uses_modular_v2_modules_and_not_legacy_orchestration():
    source = Path("app/static/js/editor_v2/core/editor_app.js").read_text(encoding="utf-8")

    assert "../document/document_controller.js" in source
    assert "../document/autosave_controller.js" in source
    assert "../document/checkpoint_controller.js" in source
    assert "../document/outline_controller.js" in source
    assert "../research/research_hydrator.js" in source
    assert "../research/explorer_controller.js" in source
    assert "../actions/insert_actions.js" in source
    assert "../actions/note_actions.js" in source
    assert "../core/async_operation.js" in Path("app/static/js/editor_v2/document/document_controller.js").read_text(encoding="utf-8")
    assert "../core/async_operation.js" in Path("app/static/js/editor_v2/document/autosave_controller.js").read_text(encoding="utf-8")
    assert "../ui/quill_adapter.js" in source
    assert "../api/workspace_api.js" in source
    assert "../api/research_api.js" in source
    assert "editor.js" not in source
    assert "editor_runtime/" not in source


def test_citation_ui_consumers_use_shared_normalized_render_contract():
    citation_contract = Path("app/static/js/shared/citation_contract.js").read_text(encoding="utf-8")
    cards_source = Path("app/static/js/app_shell/renderers/cards.js").read_text(encoding="utf-8")
    details_source = Path("app/static/js/app_shell/renderers/details.js").read_text(encoding="utf-8")
    insert_actions = Path("app/static/js/editor_v2/actions/insert_actions.js").read_text(encoding="utf-8")

    assert "citationPrimaryText" in citation_contract
    assert "citationRenderEntries" in citation_contract
    assert 'citation.renders?.mla?.bibliography' not in cards_source
    assert 'citation.renders?.mla?.bibliography' not in details_source
    assert 'citation.renders?.mla?.bibliography' not in insert_actions
    assert "citationPrimaryText(" in cards_source
    assert "citationPrimaryText(" in details_source
    assert "citationPrimaryText(" in insert_actions


def test_editor_runtime_uses_summary_boot_and_legacy_denylist():
    workspace_api = Path("app/static/js/editor_v2/api/workspace_api.js").read_text(encoding="utf-8")
    editor_source = Path("app/static/js/editor_v2/core/editor_app.js").read_text(encoding="utf-8")

    assert "/api/docs?view=summary" in workspace_api
    assert "/api/docs/${encodeURIComponent(documentId)}/hydrate" in workspace_api
    assert "/api/auth/handoff" not in workspace_api
    assert "WORK_IN_EDITOR" not in editor_source
    assert "/api/editor/access" not in editor_source
    assert "Use the explorer to choose" not in editor_source


def test_editor_runtime_uses_canonical_authenticated_request_path_for_protected_calls():
    workspace_api = Path("app/static/js/editor_v2/api/workspace_api.js").read_text(encoding="utf-8")
    research_api = Path("app/static/js/editor_v2/api/research_api.js").read_text(encoding="utf-8")
    shell_fetch = Path("app/static/js/app_shell/core/fetch.js").read_text(encoding="utf-8")
    sidebar_source = Path("app/static/js/app_shell/core/sidebar.js").read_text(encoding="utf-8")
    theme_source = Path("app/static/js/theme.js").read_text(encoding="utf-8")
    dashboard_source = Path("app/static/js/app_shell/pages/dashboard.js").read_text(encoding="utf-8")
    projects_source = Path("app/static/js/app_shell/pages/projects.js").read_text(encoding="utf-8")
    research_source = Path("app/static/js/app_shell/pages/research.js").read_text(encoding="utf-8")
    capability_source = Path("app/static/js/editor_v2/api/capability_api.js").read_text(encoding="utf-8")
    pricing_source = Path("app/static/pricing.html").read_text(encoding="utf-8")
    auth_source = Path("app/static/js/auth.js").read_text(encoding="utf-8")

    assert "authJson(" in workspace_api
    assert "authJson(" in research_api
    assert "authJson?.(" in shell_fetch
    assert "authJson?.(" in sidebar_source
    assert "authJson?.(" in theme_source
    assert "JSON.stringify(patch)" not in sidebar_source
    assert "JSON.stringify({ theme: mode })" not in theme_source
    assert "body: patch" in sidebar_source
    assert "body: { theme: mode }" in theme_source
    assert "apiFetchJson(\"/api/me\")" in dashboard_source
    assert "apiFetchJson(\"/api/projects?include_archived=false&limit=24\")" in projects_source
    assert "apiFetchJson(" in research_source
    assert "apiFetchJson(\"/api/editor/access\")" in capability_source
    assert 'authJson("/api/me"' in pricing_source
    assert 'authJson("/api/billing/checkout"' in pricing_source
    assert "Paddle.Initialize({" in pricing_source
    assert "ensurePaddleInitialized" in pricing_source
    assert "loadPublicConfig" in pricing_source
    assert 'data?.user?.id' in pricing_source
    assert 'body: JSON.stringify({ tier: plan, interval })' in pricing_source
    assert "get_" + "paddle_token" not in pricing_source
    assert "create_" + "paddle_checkout" not in pricing_source
    assert '/pricing/success' in pricing_source
    assert 'checkout=success' in pricing_source
    assert "authHeaders" not in pricing_source
    assert "fetch(\"/api/me\"" not in pricing_source
    assert "Quarterly" not in pricing_source
    assert "/3months" not in pricing_source
    assert "Pay Yearly" in pricing_source
    assert "visibilitychange" in auth_source
    assert "pageshow" in auth_source
    assert "waitForSessionReady" in auth_source
    assert "Missing bearer token" in auth_source


def test_quill_adapter_keeps_domain_logic_outside_adapter():
    source = Path("app/static/js/editor_v2/ui/quill_adapter.js").read_text(encoding="utf-8")
    assert "insertBibliography" not in source
    assert "replaceDocumentCitations" not in source
    assert "save_status" not in source
    assert "seed_state" not in source


def test_editor_toolbar_and_quill_adapter_support_production_format_controls():
    template_source = Path("app/templates/app_editor.html").read_text(encoding="utf-8")
    adapter_source = Path("app/static/js/editor_v2/ui/quill_adapter.js").read_text(encoding="utf-8")

    assert 'class="ql-header"' in template_source
    assert 'class="ql-font"' in template_source
    assert 'class="ql-size"' in template_source
    assert 'value="16px"' in template_source
    assert 'class="ql-strike"' in template_source
    assert 'class="ql-align"' in template_source
    assert 'class="ql-link"' in template_source
    assert 'class="ql-script" value="super"' in template_source
    assert 'class="ql-script" value="sub"' in template_source
    assert 'class="ql-clean"' in template_source
    assert 'editor-toolbar-toggle' not in template_source
    assert "small" not in template_source
    assert "large" not in template_source
    assert "huge" not in template_source

    assert "const FONT_FAMILIES" in adapter_source
    assert "const FONT_SIZES" in adapter_source
    assert "attributors/style/size" in adapter_source
    assert "attributors/style/font" in adapter_source
    assert "attributors/style/align" in adapter_source
    assert "normalizeEditorDelta" in adapter_source


def test_editor_empty_state_copy_is_removed_but_primary_ctas_remain():
    template_source = Path("app/templates/app_editor.html").read_text(encoding="utf-8")

    assert "Open a document or start a clean draft" not in template_source
    assert "The editor stays idle until a canonical document is selected or explicitly created." not in template_source
    assert 'id="editor-empty-new-document"' in template_source
    assert 'id="editor-empty-focus-explorer"' in template_source


def test_editor_shell_uses_viewport_bounded_height_and_internal_scroll():
    css_source = Path("app/static/css/editor_v2.css").read_text(encoding="utf-8")

    assert ".editor-v2-page {" in css_source
    assert "grid-template-rows: minmax(0, 1fr);" in css_source
    assert ".editor-v2-context-summary {\n  flex: 1 1 auto;" in css_source
    assert ".app-shell[data-page=\"editor\"] .app-content-frame,\n.app-shell[data-page=\"editor\"] .app-main {\n  height: auto;" in css_source
    assert ".app-shell[data-page=\"editor\"] .app-workspace" in css_source
    assert ".app-shell[data-page=\"editor\"] .app-main" in css_source
    assert ".editor-v2-quill .ql-editor" in css_source
    assert ".editor-v2-list-rows" in css_source
    assert ".editor-v2-context-pane > .editor-v2-scroll" in css_source
    assert "overflow: auto;" in css_source
    assert "min-height: calc(100vh - 12rem)" not in css_source


def test_workspace_state_is_single_truth_and_context_state_is_pure():
    workspace_source = Path("app/static/js/editor_v2/core/workspace_state.js").read_text(encoding="utf-8")
    selection_source = Path("app/static/js/editor_v2/core/selection_state.js").read_text(encoding="utf-8")
    context_source = Path("app/static/js/editor_v2/core/context_state.js").read_text(encoding="utf-8")
    event_bus_source = Path("app/static/js/editor_v2/core/event_bus.js").read_text(encoding="utf-8")

    assert "active_document_id" in workspace_source
    assert "save_status" in workspace_source
    assert "runtime_activity" in workspace_source
    assert "attached_relation_ids" in workspace_source
    assert "seed_state" in workspace_source
    assert "hydration" in workspace_source
    assert "text" in selection_source
    assert "composing" in selection_source
    assert "deriveContextState" in context_source
    assert "listeners = new Map()" in event_bus_source


def test_workspace_mutations_require_revision_preconditions_across_canonical_paths():
    workspace_api = Path("app/static/js/editor_v2/api/workspace_api.js").read_text(encoding="utf-8")
    workspace_service = Path("app/modules/workspace/service.py").read_text(encoding="utf-8")
    workspace_schemas = Path("app/modules/workspace/schemas.py").read_text(encoding="utf-8")
    workspace_sql = Path("writior_migration_pack/008_rpc_functions.sql").read_text(encoding="utf-8")
    workspace_state = Path("app/static/js/editor_v2/core/workspace_state.js").read_text(encoding="utf-8")

    assert "revision" in workspace_api
    assert "expected_revision" in workspace_service
    assert "revision_conflict" in workspace_service
    assert "revision" in workspace_schemas
    assert "p_expected_revision" in workspace_sql
    assert "document_conflict" in workspace_state
