from pathlib import Path


def test_extension_implements_layered_metadata_pipeline_and_confidence():
    source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")

    assert "METADATA_SOURCE_CONFIDENCE" in source
    assert 'meta[name="citation_title"]' in source
    assert 'script[type="application/ld+json"]' in source
    assert 'meta[name="DC.title"]' in source
    assert 'meta[property="og:site_name"]' in source
    assert "sourceField" in source
    assert "classifySource" in source


def test_webapp_and_extension_include_domain_intelligence_and_doi_preference():
    extension_source = Path("extension/content/unlock_content.js").read_text(encoding="utf-8")
    webapp_source = Path("app/static/unlock.js").read_text(encoding="utf-8")

    for source in (extension_source, webapp_source):
        assert "DOMAIN_INTELLIGENCE" in source
        assert "arxiv.org" in source
        assert "journal_article" in source
        assert "https://doi.org/" in source
        assert "Available at:" in source
