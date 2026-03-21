from pathlib import Path

import pytest
from pydantic import ValidationError

from app.services.citation_domain import (
    ExtractionCandidate,
    ExtractionPayload,
    SUPPORTED_RENDER_KINDS,
    SUPPORTED_STYLES,
    generate_render_bundle,
    normalize_citation_payload,
)


def _canonical_payload() -> ExtractionPayload:
    return ExtractionPayload(
        canonical_url="https://example.com/paper",
        page_url="https://example.com/paper",
        title_candidates=[ExtractionCandidate(value="Paper title", confidence=1.0)],
        author_candidates=[ExtractionCandidate(value="Alice Doe", confidence=1.0)],
        date_candidates=[ExtractionCandidate(value="2024-02-03", confidence=1.0)],
        locator={"paragraph": 4},
        raw_metadata={
            "quote": "Quoted sentence",
            "excerpt": "Quoted sentence",
        },
    )


def test_extraction_payload_rejects_legacy_metadata_dicts():
    with pytest.raises(ValidationError):
        ExtractionPayload.model_validate({"title": "Paper title", "author": "Alice Doe"})


def test_normalize_citation_payload_separates_source_from_context():
    normalized = normalize_citation_payload(_canonical_payload())

    assert normalized["source"]["title"] == "Paper title"
    assert normalized["source"]["canonical_url"] == "https://example.com/paper"
    assert normalized["context"]["quote"] == "Quoted sentence"
    assert normalized["context"]["locator"] == {"paragraph": 4}


def test_generate_render_bundle_covers_all_supported_styles_and_render_kinds():
    normalized = normalize_citation_payload(_canonical_payload())

    bundle = generate_render_bundle(normalized["source"], normalized["context"])

    assert set(bundle["renders"].keys()) == SUPPORTED_STYLES
    assert set(bundle["renders"]["mla"].keys()) == SUPPORTED_RENDER_KINDS


def test_app_source_files_do_not_reference_citation_engine_module():
    hits = []
    for path in Path("app").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "citation_engine" in text:
            hits.append(str(path))

    assert hits == []
