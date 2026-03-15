from pathlib import Path


def test_editor_template_loads_runtime_modules_before_editor_js():
    source = Path("app/templates/editor.html").read_text(encoding="utf-8")

    assert '/static/js/editor_runtime/core.js' in source
    assert '/static/js/editor_runtime/instrumentation.js' in source
    assert '/static/js/editor_runtime/active_document.js' in source
    assert '/static/js/editor_runtime/editor_session.js' in source
    assert '/static/js/editor_runtime/notes_store.js' in source
    assert '/static/js/editor_runtime/citations_store.js' in source
    assert '/static/js/editor_runtime/renderers.js' in source
    assert source.index('/static/js/editor_runtime/core.js') < source.index('/static/js/editor.js')


def test_editor_runtime_requires_window_runtime_modules_and_summary_docs_view():
    source = Path("app/static/js/editor.js").read_text(encoding="utf-8")

    assert 'window.WritiorEditorRuntime' in source
    assert 'runtime.require("instrumentation")' in source
    assert 'runtime.require("activeDocument")' in source
    assert 'runtime.require("editorSession")' in source
    assert 'runtime.require("notesStore")' in source
    assert 'runtime.require("citationsStore")' in source
    assert 'runtime.require("renderers")' in source
    assert '"/api/docs?view=summary"' in source
    assert 'boot:first_active_document_ready' in source
