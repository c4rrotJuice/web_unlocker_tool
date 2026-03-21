from app.services.citation_domain import (
    ExtractionCandidate,
    ExtractionPayload,
    METADATA_SCHEMA_VERSION,
    build_source_fingerprint,
    compute_source_version,
    generate_render_bundle,
    normalize_citation_payload,
    render_citation,
)


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


def test_normalize_citation_payload_dedupes_institutional_author_and_publisher():
    source, context = _canonical_payload()
    source = {
        **source,
        "publisher": "World Health Organization",
        "site_name": "World Health Organization",
    }
    payload = {
        "identifiers": source.get("identifiers", {}),
        "canonical_url": source.get("canonical_url"),
        "page_url": source.get("page_url"),
        "title_candidates": [ExtractionCandidate(value=source["title"], confidence=1.0)],
        "author_candidates": [ExtractionCandidate(value="World Health Organization", confidence=1.0)],
        "date_candidates": [ExtractionCandidate(value=source["issued"]["raw"], confidence=1.0)],
        "publisher_candidates": [ExtractionCandidate(value="World Health Organization", confidence=1.0)],
        "selection_text": context["quote"],
        "locator": context["locator"],
        "raw_metadata": {
            "quote": context["quote"],
            "excerpt": context["excerpt"],
            "siteName": "World Health Organization",
            "publisher": "World Health Organization",
        },
    }
    normalized = normalize_citation_payload(ExtractionPayload.model_validate(payload))

    assert normalized["source"]["author"] == "World Health Organization"
    assert len(normalized["source"]["authors"]) == 1
    assert normalized["context"]["locator"] == {"paragraph": 6}
    assert normalized["source"]["metadata_schema_version"] == METADATA_SCHEMA_VERSION
    assert normalized["source"]["fingerprint"].startswith("url:")
    assert normalized["source"]["source_version"]
    assert normalized["context"]["citation_version"]


def test_render_citation_separates_inline_and_full():
    source, context = _canonical_payload()
    outputs = {
        "inline_citation": render_citation(source, context, style="apa", render_kind="inline"),
        "full_citation": render_citation(source, context, style="apa", render_kind="bibliography"),
    }

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
