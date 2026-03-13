from pathlib import Path


def test_webapp_uses_normalized_metadata_for_copy_formats():
    source = Path("app/static/unlock.js").read_text(encoding="utf-8")

    assert "validateCitationMetadata(getCitationMetadata" in source
    assert "fetch('/api/citations/render'" in source
    assert "formatCitation(style, metadata)" in source
    assert "copyCitation(btn.dataset.citeId, btn.dataset.citeFormat, metadata)" in source


def test_webapp_supports_academic_quote_locators():
    source = Path("app/static/unlock.js").read_text(encoding="utf-8")

    assert "par. ${para}" in source
    assert "para. ${para}" in source
    assert "Available at:" in source
