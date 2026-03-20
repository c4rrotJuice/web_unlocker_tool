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
    assert "../ui/quill_adapter.js" in source
    assert "../api/workspace_api.js" in source
    assert "../api/research_api.js" in source
    assert "editor.js" not in source
    assert "editor_runtime/" not in source


def test_editor_runtime_uses_summary_boot_and_legacy_denylist():
    workspace_api = Path("app/static/js/editor_v2/api/workspace_api.js").read_text(encoding="utf-8")
    editor_source = Path("app/static/js/editor_v2/core/editor_app.js").read_text(encoding="utf-8")

    assert "/api/docs?view=summary" in workspace_api
    assert "/api/docs/${encodeURIComponent(documentId)}/hydrate" in workspace_api
    assert "/api/auth/handoff" not in workspace_api
    assert "WORK_IN_EDITOR" not in editor_source
    assert "/api/editor/access" not in editor_source


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
    assert "small" not in template_source
    assert "large" not in template_source
    assert "huge" not in template_source

    assert "const FONT_FAMILIES" in adapter_source
    assert "const FONT_SIZES" in adapter_source
    assert "attributors/style/size" in adapter_source
    assert "attributors/style/font" in adapter_source
    assert "attributors/style/align" in adapter_source


def test_workspace_state_is_single_truth_and_context_state_is_pure():
    workspace_source = Path("app/static/js/editor_v2/core/workspace_state.js").read_text(encoding="utf-8")
    selection_source = Path("app/static/js/editor_v2/core/selection_state.js").read_text(encoding="utf-8")
    context_source = Path("app/static/js/editor_v2/core/context_state.js").read_text(encoding="utf-8")
    event_bus_source = Path("app/static/js/editor_v2/core/event_bus.js").read_text(encoding="utf-8")

    assert "active_document_id" in workspace_source
    assert "save_status" in workspace_source
    assert "attached_relation_ids" in workspace_source
    assert "seed_state" in workspace_source
    assert "hydration" in workspace_source
    assert "text" in selection_source
    assert "composing" in selection_source
    assert "deriveContextState" in context_source
    assert "listeners = new Map()" in event_bus_source
