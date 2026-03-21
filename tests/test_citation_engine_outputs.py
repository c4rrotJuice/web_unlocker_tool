from app.services.citation_engine import (
    build_source_fingerprint,
    compute_source_version,
    generate_citation_outputs,
    generate_render_bundle,
    normalize_metadata,
)
from app.services.citation_domain import ExtractionCandidate, ExtractionPayload, METADATA_SCHEMA_VERSION, normalize_citation_payload


def _canonical_payload() -> tuple[dict[str, object], dict[str, object]]:
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://www.who.int/example",
            page_url="https://www.who.int/example",
            title_candidates=[ExtractionCandidate(value="Public health update", confidence=1.0)],
            author_candidates=[ExtractionCandidate(value="World Health Organization", confidence=1.0)],
            date_candidates=[ExtractionCandidate(value="2024-03-10", confidence=1.0)],
            locator={"paragraph": 6},
            raw_metadata={
                "quote": "Selected sentence",
                "excerpt": "Selected sentence",
            },
        )
    )
    return normalized["source"], normalized["context"]


def test_normalize_metadata_dedupes_institutional_author_and_publisher():
    source, context = _canonical_payload()
    source = {
        **source,
        "publisher": "World Health Organization",
        "site_name": "World Health Organization",
    }
    meta = normalize_metadata(source, context)

    assert meta["author"] == "World Health Organization"
    assert len(meta["authors"]) == 1
    assert meta["paragraph"] == 6
    assert meta["metadata_schema_version"] == METADATA_SCHEMA_VERSION
    assert meta["source_fingerprint"].startswith("url:")
    assert meta["source"]["fingerprint"] == meta["source_fingerprint"]
    assert meta["quote"]["locator"] == {"paragraph": 6}


def test_generate_citation_outputs_separates_inline_and_full():
    source, context = _canonical_payload()
    outputs = generate_citation_outputs("apa", source, context)

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
    source, context = _canonical_payload()
    bundle = generate_render_bundle(source, context)

    assert set(bundle["renders"].keys()) == {"apa", "chicago", "harvard", "mla"}
    assert bundle["source"]["source_version"] == bundle["source_version"]
    assert bundle["citation_version"]
