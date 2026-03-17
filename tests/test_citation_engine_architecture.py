from pathlib import Path


def test_extension_uses_modular_metadata_and_capture_components():
    index_source = Path("extension/content/index.js").read_text(encoding="utf-8")
    metadata_source = Path("extension/content/metadata_extractor.js").read_text(encoding="utf-8")
    pill_source = Path("extension/content/capture_pill.js").read_text(encoding="utf-8")

    assert "./metadata_extractor.js" in index_source
    assert "./capture_pill.js" in index_source
    assert "./note_composer.js" in index_source
    assert "script[type=\"application/ld+json\"]" in metadata_source
    assert "meta[name=\"author\"]" in metadata_source
    assert "MESSAGE_TYPES.CAPTURE_CITATION" in pill_source
    assert "MESSAGE_TYPES.CAPTURE_QUOTE" in pill_source


def test_extension_overlay_css_isolated_in_shadow_root_assets():
    overlay_source = Path("extension/content/overlay_root.js").read_text(encoding="utf-8")
    style_source = Path("extension/styles/overlay.css.js").read_text(encoding="utf-8")

    assert "attachShadow" in overlay_source
    assert ".writior-overlay-root" in style_source
    assert ".writior-pill" in style_source
