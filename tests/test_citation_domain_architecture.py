from app.services.citation_domain import (
    SUPPORTED_RENDER_KINDS,
    SUPPORTED_STYLES,
    generate_render_bundle,
    legacy_metadata_to_payload,
    normalize_citation_payload,
)


def test_normalize_citation_payload_separates_source_from_context():
    normalized = normalize_citation_payload(
        legacy_metadata_to_payload(
            url="https://example.com/paper",
            excerpt="Quoted sentence",
            metadata={
                "title": "Paper title",
                "author": "Alice Doe",
                "siteName": "Example Journal",
                "datePublished": "2024-02-03",
                "paragraph": 4,
            },
        ),
    )

    assert normalized["source"]["title"] == "Paper title"
    assert normalized["source"]["canonical_url"] == "https://example.com/paper"
    assert normalized["context"]["quote"] == "Quoted sentence"
    assert normalized["context"]["locator"] == {"paragraph": 4}


def test_generate_render_bundle_covers_all_supported_styles_and_render_kinds():
    normalized = normalize_citation_payload(
        legacy_metadata_to_payload(
            url="https://example.com/paper",
            excerpt="Quoted sentence",
            metadata={
                "title": "Paper title",
                "author": "Alice Doe",
                "siteName": "Example Journal",
                "datePublished": "2024-02-03",
            },
        ),
    )

    bundle = generate_render_bundle(normalized["source"], normalized["context"])

    assert set(bundle["renders"].keys()) == SUPPORTED_STYLES
    assert set(bundle["renders"]["mla"].keys()) == SUPPORTED_RENDER_KINDS
