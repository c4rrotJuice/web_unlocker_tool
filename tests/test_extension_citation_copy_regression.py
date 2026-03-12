from pathlib import Path


def test_extension_copy_uses_popup_preview_text_to_avoid_missing_metadata():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "const citationPreview = popup.querySelector(`#cite-${format}`);" in source
    assert "citationPreview?.textContent" in source


def test_extension_fallback_formatter_uses_normalized_metadata_object():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "formatCitation(format, metadata);" in source
    assert "validateCitationMetadata(getCitationMetadata(selectionText))" in source


def test_extension_metadata_extractor_includes_layered_fallback_strategies():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "script[type=\"application/ld+json\"]" in source
    assert 'meta[property="og:title"]' in source
    assert 'meta[name="author"]' in source
    assert '[itemprop="headline"]' in source
    assert ".byline" in source
