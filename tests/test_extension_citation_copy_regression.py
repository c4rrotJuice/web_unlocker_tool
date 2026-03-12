from pathlib import Path


def test_extension_copy_uses_popup_preview_text_to_avoid_missing_metadata():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "const citationPreview = popup.querySelector(`#cite-${format}`);" in source
    assert "citationPreview?.textContent" in source


def test_extension_fallback_formatter_call_passes_site_and_author():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "formatCitation(\n            format,\n            selectionText,\n            title,\n            url,\n            accessed,\n            siteName,\n            author,\n          );" in source
