from app.services.citation_engine import (
    METADATA_SCHEMA_VERSION,
    build_source_fingerprint,
    compute_source_version,
    generate_citation_outputs,
    generate_render_bundle,
    normalize_metadata,
)


def test_normalize_metadata_dedupes_institutional_author_and_publisher():
    meta = normalize_metadata(
        {
            "author": "WHO",
            "publisher": "World Health Organization",
            "siteName": "World Health Organization",
            "title": "Fact sheet",
            "datePublished": "n.d.",
            "paragraph": "6",
        },
        url="https://www.who.int/news-room/fact-sheets/detail/example",
        excerpt="sample",
    )

    assert meta["author"] == "World Health Organization"
    assert len(meta["authors"]) == 1
    assert meta["paragraph"] == 6
    assert meta["metadata_schema_version"] == METADATA_SCHEMA_VERSION
    assert meta["source_fingerprint"].startswith("url:")
    assert meta["source"]["fingerprint"] == meta["source_fingerprint"]


def test_generate_citation_outputs_separates_inline_and_full():
    outputs = generate_citation_outputs(
        "apa",
        {
            "author": "World Health Organization",
            "title": "Public health update",
            "siteName": "World Health Organization",
            "url": "https://www.who.int/example",
            "datePublished": "2024-03-10",
            "paragraph": 6,
        },
    )

    assert outputs["inline_citation"] == "(World Health Organization, 2024, para. 6)"
    assert "World Health Organization. (2024)." in outputs["full_citation"]


def test_source_fingerprint_prefers_doi_then_url_then_metadata_hash():
    doi_fp = build_source_fingerprint({"doi": "10.1000/XYZ"})
    url_fp = build_source_fingerprint({"url": "https://Example.com/path#section"})
    meta_fp = build_source_fingerprint({"title": "A", "author": "B", "datePublished": "2024"})

    assert doi_fp == "doi:10.1000/xyz"
    assert url_fp == "url:https://example.com/path"
    assert meta_fp.startswith("meta:")


def test_source_version_changes_when_canonical_metadata_changes():
    base = {
        "title": "A title",
        "authors": [{"fullName": "Alice Doe"}],
        "publisher": "Example Org",
        "siteName": "Example Org",
        "datePublished": "2024-01-01",
        "url": "https://example.com/x",
    }
    v1 = compute_source_version(base)
    v2 = compute_source_version({**base, "title": "A changed title"})

    assert v1 != v2


def test_generate_render_bundle_contains_multi_style_cache_ready_payload():
    bundle = generate_render_bundle(
        {
            "title": "Public health update",
            "author": "World Health Organization",
            "siteName": "WHO",
            "url": "https://www.who.int/example",
            "datePublished": "2024-03-10",
            "excerpt": "Selected sentence",
        },
    )

    assert set(bundle["renders"].keys()) == {"apa", "chicago", "harvard", "mla"}
    assert bundle["metadata"]["source_version"] == bundle["source_version"]
