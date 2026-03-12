from pathlib import Path


def test_editor_template_has_inline_citation_style_selector_and_doc_notes_toggle():
    template = Path("app/templates/editor.html").read_text(encoding="utf-8")

    assert 'id="citation-inline-style"' in template
    assert 'value="apa"' in template
    assert 'value="mla"' in template
    assert 'value="chicago"' in template
    assert 'value="harvard"' in template
    assert 'id="tool-doc-notes"' in template
    assert 'id="doc-notes-panel"' in template and 'collapsed" id="doc-notes-panel"' in template


def test_editor_javascript_uses_selected_citation_style_and_no_longer_inserts_citation_ids():
    source = Path("app/static/js/editor.js").read_text(encoding="utf-8")

    assert "function citationStyle()" in source
    assert "Insert ${citationStyle().toUpperCase()}" in source
    assert "quill.insertText(insertIndex, `${inText} `" in source
    assert "${inText}${token}" not in source


def test_editor_styles_hide_collapsed_secondary_panels_and_add_click_feedback():
    css = Path("app/static/css/editor.css").read_text(encoding="utf-8")

    assert ".editor-secondary-panel.collapsed { display:none; }" in css
    assert "button:active, button.is-clicked" in css
    assert ".sidebar-left, .sidebar-right, .editor-main { min-height: 420px;" in css
