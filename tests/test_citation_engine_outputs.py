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


def test_normalization_logs_input_and_selected_output(caplog):
    with caplog.at_level("INFO"):
        normalized = normalize_citation_payload(
            ExtractionPayload(
                canonical_url="https://example.com/logged",
                page_url="https://example.com/logged?utm=feed",
                title_candidates=[ExtractionCandidate(value="Logged title", confidence=1.0, source="meta:name:citation_title")],
                author_candidates=[ExtractionCandidate(value="Ada Lovelace", confidence=1.0, source="meta:name:citation_author")],
                date_candidates=[ExtractionCandidate(value="2024-02-03", confidence=1.0, source="meta:name:citation_publication_date")],
                identifiers={"doi": "10.1000/logged"},
            )
        )

    assert normalized["source"]["identifiers"]["doi"] == "10.1000/logged"
    start = next(record for record in caplog.records if record.msg == "citation.normalize.start")
    selected = next(record for record in caplog.records if record.msg == "citation.normalize.selected")
    assert start.canonical_url == "https://example.com/logged"
    assert start.identifier_keys == ["doi"]
    assert selected.author_count == 1
    assert selected.issued_raw == "2024-02-03"
    assert selected.fingerprint == "doi:10.1000/logged"


def test_render_citation_separates_inline_and_full():
    source, context = _canonical_payload()
    outputs = {
        "inline_citation": render_citation(source, context, style="apa", render_kind="inline"),
        "full_citation": render_citation(source, context, style="apa", render_kind="bibliography"),
    }

    assert outputs["inline_citation"] == "(World Health Organization, 2024, para. 6)"
    assert "World Health Organization. (2024, March 10)." in outputs["full_citation"]


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


def test_normalization_prefers_doi_and_citation_meta_over_generic_tags():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/article?utm_source=newsletter",
            page_url="https://example.com/article?utm_source=newsletter",
            title_candidates=[
                ExtractionCandidate(value="Weak generic title", confidence=0.99, source="meta:property:og:title"),
                ExtractionCandidate(value="Canonical Scholarly Title", confidence=0.8, source="meta:name:citation_title"),
            ],
            author_candidates=[
                ExtractionCandidate(value="Example.com", confidence=0.99, source="page.domain"),
                ExtractionCandidate(value="Ada Lovelace", confidence=0.7, source="meta:name:citation_author"),
            ],
            date_candidates=[
                ExtractionCandidate(value="2024-01-01", confidence=0.99, source="dom:time"),
                ExtractionCandidate(value="2024-02-03", confidence=0.7, source="meta:name:citation_publication_date"),
            ],
            container_candidates=[
                ExtractionCandidate(value="Journal of Analytical Engines", confidence=0.7, source="meta:name:citation_journal_title"),
            ],
            publisher_candidates=[
                ExtractionCandidate(value="Example Press", confidence=0.6, source="meta:property:og:site_name"),
            ],
            source_type_candidates=[ExtractionCandidate(value="article", confidence=0.8, source="meta:property:og:type")],
            identifiers={"doi": "https://doi.org/10.1000/Test-DOI"},
        )
    )

    assert normalized["source"]["title"] == "Canonical Scholarly Title"
    assert normalized["source"]["authors"][0]["fullName"] == "Ada Lovelace"
    assert normalized["source"]["issued"]["raw"] == "2024-02-03"
    assert normalized["source"]["container_title"] == "Journal of Analytical Engines"
    assert normalized["source"]["identifiers"]["doi"] == "10.1000/test-doi"
    assert normalized["source"]["fingerprint"] == "doi:10.1000/test-doi"


def test_normalization_handles_multiple_and_organization_authors():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/report",
            page_url="https://example.com/report?ref=homepage",
            title_candidates=[ExtractionCandidate(value="Climate Assessment", confidence=1.0, source="jsonld:report")],
            author_candidates=[
                ExtractionCandidate(value="Doe, Jane; Roe, John", confidence=0.9, source="meta:name:citation_author"),
                ExtractionCandidate(value="World Health Organization", confidence=0.85, source="jsonld:report"),
            ],
            publisher_candidates=[ExtractionCandidate(value="World Health Organization", confidence=0.9, source="jsonld:report")],
            source_type_candidates=[ExtractionCandidate(value="report", confidence=1.0, source="jsonld:report")],
        )
    )

    assert [author["fullName"] for author in normalized["source"]["authors"]] == [
        "Jane Doe",
        "John Roe",
        "World Health Organization",
    ]
    assert normalized["source"]["authors"][2]["isOrganization"] is True
    assert normalized["source"]["source_type"] == "report"


def test_normalization_prefers_structured_authors_over_weaker_dom_conflicts():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/structured-authors",
            page_url="https://example.com/structured-authors",
            title_candidates=[ExtractionCandidate(value="Structured authors", confidence=1.0, source="jsonld:article")],
            author_candidates=[
                ExtractionCandidate(value="Ada Lovelace", confidence=0.7, source="meta:name:citation_author"),
                ExtractionCandidate(value="Byline Widget", confidence=0.99, source="dom:byline"),
            ],
            raw_metadata={"site_name": "Example Journal"},
        )
    )

    assert [author["fullName"] for author in normalized["source"]["authors"]] == ["Ada Lovelace"]


def test_normalization_composes_given_and_family_names_from_raw_metadata_authors():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/split-author",
            page_url="https://example.com/split-author",
            title_candidates=[ExtractionCandidate(value="Split name article", confidence=1.0)],
            raw_metadata={
                "authors": [
                    {"givenName": "Grace", "familyName": "Hopper"},
                ]
            },
        )
    )

    assert [author["fullName"] for author in normalized["source"]["authors"]] == ["Grace Hopper"]


def test_normalization_keeps_organization_author_intact_without_splitting():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/org-author",
            page_url="https://example.com/org-author",
            title_candidates=[ExtractionCandidate(value="Org author article", confidence=1.0)],
            author_candidates=[
                ExtractionCandidate(value="Center for Research and Policy", confidence=1.0, source="jsonld:report"),
            ],
            publisher_candidates=[ExtractionCandidate(value="Center for Research and Policy", confidence=1.0, source="jsonld:report")],
            source_type_candidates=[ExtractionCandidate(value="report", confidence=1.0, source="jsonld:report")],
        )
    )

    assert [author["fullName"] for author in normalized["source"]["authors"]] == ["Center for Research and Policy"]
    assert normalized["source"]["authors"][0]["isOrganization"] is True


def test_normalization_tracks_issued_modified_and_accessed_dates():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/news",
            page_url="https://example.com/news#section",
            title_candidates=[ExtractionCandidate(value="News update", confidence=1.0, source="jsonld:newsarticle")],
            date_candidates=[ExtractionCandidate(value="2024-05", confidence=0.9, source="jsonld:newsarticle")],
            raw_metadata={
                "dateModified": "2024-05-07T10:00:00Z",
                "accessed": "2026-03-23",
            },
            source_type_candidates=[ExtractionCandidate(value="newsarticle", confidence=1.0, source="jsonld:newsarticle")],
        )
    )

    assert normalized["source"]["issued"]["raw"] == "2024-05"
    assert normalized["source"]["issued"]["month"] == 5
    assert normalized["source"]["metadata"]["modified_date"]["iso"] == "2024-05-07"
    assert normalized["source"]["metadata"]["accessed_date"]["iso"] == "2026-03-23"
    assert normalized["source"]["source_type"] == "article"


def test_normalization_prefers_published_date_over_modified_candidate_noise():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/date-ordering",
            page_url="https://example.com/date-ordering",
            title_candidates=[ExtractionCandidate(value="Date ordering", confidence=1.0)],
            date_candidates=[
                ExtractionCandidate(value="2024-05-07", confidence=0.99, source="meta:property:article:modified_time"),
                ExtractionCandidate(value="2024-05-06", confidence=0.7, source="meta:property:article:published_time"),
            ],
        )
    )

    assert normalized["source"]["issued"]["raw"] == "2024-05-06"


def test_normalization_prefers_explicit_canonical_url_over_page_url():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/article",
            page_url="https://example.com/article?utm_source=newsletter",
            title_candidates=[ExtractionCandidate(value="Canonical stability", confidence=1.0)],
        )
    )

    assert normalized["source"]["canonical_url"] == "https://example.com/article"
    assert normalized["source"]["page_url"] == "https://example.com/article?utm_source=newsletter"


def test_normalization_preserves_and_normalizes_doi_identifier():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/doi-normalization",
            page_url="https://example.com/doi-normalization",
            title_candidates=[ExtractionCandidate(value="DOI normalization", confidence=1.0)],
            identifiers={"doi": "DOI: 10.5555/ABC-123."},
        )
    )

    assert normalized["source"]["identifiers"]["doi"] == "10.5555/abc-123"


def test_normalization_infers_dataset_and_preserves_canonical_url_separately():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://data.example.org/dataset/123",
            page_url="https://data.example.org/dataset/123?download=1",
            title_candidates=[ExtractionCandidate(value="Global climate dataset", confidence=1.0, source="jsonld:dataset")],
            source_type_candidates=[ExtractionCandidate(value="dataset", confidence=1.0, source="jsonld:dataset")],
            identifiers={"issn": "12345678", "isbn": "978-1-4028-9462-6"},
        )
    )

    assert normalized["source"]["canonical_url"] == "https://data.example.org/dataset/123"
    assert normalized["source"]["page_url"] == "https://data.example.org/dataset/123?download=1"
    assert normalized["source"]["source_type"] == "dataset"
    assert normalized["source"]["identifiers"]["issn"] == "1234-5678"
    assert normalized["source"]["identifiers"]["isbn"] == "9781402894626"


def test_renderer_handles_multi_author_journal_article_across_styles():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/paper",
            page_url="https://example.com/paper?ref=feed",
            title_candidates=[ExtractionCandidate(value="Structured scholarship", confidence=1.0, source="meta:name:citation_title")],
            author_candidates=[
                ExtractionCandidate(value="Doe, Jane; Roe, John; Poe, Alex", confidence=1.0, source="meta:name:citation_author"),
            ],
            date_candidates=[ExtractionCandidate(value="2024-02-03", confidence=1.0, source="meta:name:citation_publication_date")],
            container_candidates=[ExtractionCandidate(value="Journal of Structured Studies", confidence=1.0, source="meta:name:citation_journal_title")],
            source_type_candidates=[ExtractionCandidate(value="scholarlyarticle", confidence=1.0, source="jsonld:scholarlyarticle")],
            identifiers={"doi": "10.1000/render-doi"},
            locator={"page": "15"},
            raw_metadata={"volume": "12", "issue": "3", "first_page": "101", "last_page": "120"},
        )
    )
    source = normalized["source"]
    context = normalized["context"]

    assert render_citation(source, context, style="apa", render_kind="inline") == "(Doe et al., 2024, p. 15)"
    assert "https://doi.org/10.1000/render-doi" in render_citation(source, context, style="apa", render_kind="bibliography")
    assert "vol. 12" in render_citation(source, context, style="mla", render_kind="bibliography")
    assert "no. 3" in render_citation(source, context, style="chicago", render_kind="bibliography")
    assert "Available at: https://doi.org/10.1000/render-doi" in render_citation(source, context, style="harvard", render_kind="bibliography")


def test_renderer_uses_access_date_for_web_citations_and_canonical_url():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/news/article",
            page_url="https://example.com/news/article?utm=campaign",
            title_candidates=[ExtractionCandidate(value="Web policy update", confidence=1.0)],
            author_candidates=[ExtractionCandidate(value="Example Newsroom", confidence=1.0)],
            date_candidates=[ExtractionCandidate(value="2024-03-10", confidence=1.0)],
            source_type_candidates=[ExtractionCandidate(value="article", confidence=1.0)],
            raw_metadata={"accessed": "2026-03-23"},
        )
    )
    source = normalized["source"]

    mla = render_citation(source, normalized["context"], style="mla", render_kind="bibliography")
    harvard = render_citation(source, normalized["context"], style="harvard", render_kind="bibliography")

    assert "https://example.com/news/article" in mla
    assert "?utm=campaign" not in mla
    assert "Accessed 23 March 2026" in mla
    assert "(Accessed: 23 March 2026)." in harvard


def test_renderer_distinguishes_report_book_and_dataset_outputs():
    report = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/report",
            page_url="https://example.com/report",
            title_candidates=[ExtractionCandidate(value="Annual report", confidence=1.0)],
            publisher_candidates=[ExtractionCandidate(value="Ministry of Health", confidence=1.0)],
            source_type_candidates=[ExtractionCandidate(value="report", confidence=1.0)],
        )
    )["source"]
    book = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/book",
            page_url="https://example.com/book",
            title_candidates=[ExtractionCandidate(value="Book of Examples", confidence=1.0)],
            author_candidates=[ExtractionCandidate(value="Ada Lovelace", confidence=1.0)],
            source_type_candidates=[ExtractionCandidate(value="book", confidence=1.0)],
            raw_metadata={"publisher": "Example Press"},
        )
    )["source"]
    dataset = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/dataset",
            page_url="https://example.com/dataset",
            title_candidates=[ExtractionCandidate(value="Example Dataset", confidence=1.0)],
            publisher_candidates=[ExtractionCandidate(value="Data Lab", confidence=1.0)],
            source_type_candidates=[ExtractionCandidate(value="dataset", confidence=1.0)],
        )
    )["source"]

    assert "Annual report" in render_citation(report, {"locator": {}}, style="apa", render_kind="bibliography")
    assert "*Book Of Examples*" in render_citation(book, {"locator": {}}, style="mla", render_kind="bibliography")
    assert "[Data set]" in render_citation(dataset, {"locator": {}}, style="apa", render_kind="bibliography")


def test_renderer_handles_missing_author_and_missing_date_honestly():
    normalized = normalize_citation_payload(
        ExtractionPayload(
            canonical_url="https://example.com/untitled",
            page_url="https://example.com/untitled",
            title_candidates=[ExtractionCandidate(value="Fallback Source", confidence=1.0)],
        )
    )
    source = normalized["source"]
    context = normalized["context"]

    assert render_citation(source, context, style="apa", render_kind="inline") == "(Fallback Source)"
    assert "n.d." in render_citation(source, context, style="apa", render_kind="bibliography")
    assert "(Fallback Source)" == render_citation(source, context, style="mla", render_kind="quote_attribution")
