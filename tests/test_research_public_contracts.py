from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.extension.schemas import ExtensionCitationCaptureRequest
from app.modules.research.citations.schemas import CitationCreateRequest, CitationPreviewRequest
from app.modules.research.routes import create_citation, preview_citation, resolve_source
from app.modules.research.sources.schemas import SourceResolveRequest


def _canonical_extraction_payload() -> dict[str, object]:
    return {
        "canonical_url": "https://example.com/paper",
        "page_url": "https://example.com/paper",
        "title_candidates": [{"value": "Paper title", "confidence": 1.0}],
        "author_candidates": [{"value": "Ada Lovelace", "confidence": 1.0}],
        "date_candidates": [{"value": "2024-02-03", "confidence": 1.0}],
        "container_candidates": [{"value": "Journal of Analytical Engines", "confidence": 0.88, "source": "meta:name:citation_journal_title"}],
        "publisher_candidates": [{"value": "Example Press", "confidence": 0.8, "source": "meta:property:og:site_name"}],
        "source_type_candidates": [{"value": "scholarlyarticle", "confidence": 0.85, "source": "jsonld:scholarlyarticle"}],
        "identifiers": {"doi": "10.1000/example-doi", "issn": "1234-5678"},
        "locator": {"paragraph": 4},
        "extraction_evidence": {
            "meta_tags": {
                "authors": [{"value": "Ada Lovelace", "source": "meta:name:author", "key": "author"}],
            }
        },
        "raw_metadata": {
            "quote": "Quoted sentence",
            "excerpt": "Quoted sentence",
            "site_name": "Example Journal",
            "language": "en",
            "description": "A preserved description",
        },
    }


def _access_context() -> SimpleNamespace:
    return SimpleNamespace(
        user_id="user-1",
        access_token="token",
        capability_state=SimpleNamespace(tier="pro"),
    )


def test_source_resolve_schema_rejects_legacy_url_metadata_shape():
    with pytest.raises(ValidationError):
        SourceResolveRequest.model_validate(
            {
                "extraction_payload": {
                    "url": "https://example.com/paper",
                    "metadata": {"title": "Paper title"},
                }
            }
        )


@pytest.mark.anyio
async def test_source_resolve_handler_accepts_canonical_extraction_payload(monkeypatch):
    captured = {}

    async def fake_resolve_or_create_source(*, access_token, extraction_payload):
        captured["access_token"] = access_token
        captured["extraction_payload"] = extraction_payload
        return {"ok": True, "data": {"id": "source-1"}, "meta": {}, "error": None}

    monkeypatch.setattr("app.modules.research.routes.sources_service.resolve_or_create_source", fake_resolve_or_create_source)

    payload = SourceResolveRequest.model_validate({"extraction_payload": _canonical_extraction_payload()})
    response = await resolve_source(payload, access=_access_context())

    assert response["data"]["id"] == "source-1"
    assert captured["access_token"] == "token"
    assert captured["extraction_payload"].canonical_url == "https://example.com/paper"


def test_citation_create_schema_rejects_legacy_metadata_shape():
    with pytest.raises(ValidationError):
        CitationCreateRequest.model_validate(
            {
                "extraction_payload": {
                    "url": "https://example.com/paper",
                    "metadata": {"title": "Paper title", "author": "Ada Lovelace"},
                },
                "excerpt": "Quoted sentence",
                "quote": "Quoted sentence",
                "locator": {"paragraph": 4},
                "style": "mla",
            }
    )


def test_extension_capture_schema_accepts_canonical_extraction_payload():
    payload = ExtensionCitationCaptureRequest.model_validate(
        {
            "extraction_payload": _canonical_extraction_payload(),
            "excerpt": "Quoted sentence",
            "quote": "Quoted sentence",
            "locator": {"paragraph": 4},
            "style": "mla",
        }
    )

    assert payload.extraction_payload.canonical_url == "https://example.com/paper"
    assert payload.extraction_payload.identifiers["doi"] == "10.1000/example-doi"
    assert payload.extraction_payload.container_candidates[0].value == "Journal of Analytical Engines"


@pytest.mark.anyio
async def test_citation_create_handler_accepts_canonical_extraction_payload(monkeypatch):
    captured = {}

    async def fake_create_citation(
        *,
        user_id,
        access_token,
        account_type,
        extraction_payload,
        excerpt,
        locator,
        annotation,
        quote,
        style,
    ):
        captured["user_id"] = user_id
        captured["access_token"] = access_token
        captured["account_type"] = account_type
        captured["extraction_payload"] = extraction_payload
        captured["excerpt"] = excerpt
        captured["locator"] = locator
        captured["annotation"] = annotation
        captured["quote"] = quote
        captured["style"] = style
        return {
            "id": "citation-1",
            "source_id": "source-1",
            "source": {"id": "source-1"},
            "locator": {"paragraph": 4},
            "annotation": None,
            "excerpt": "Quoted sentence",
            "quote_text": "Quoted sentence",
            "renders": {"mla": {"inline": "(Ada)"}},
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "relationship_counts": {},
        }

    monkeypatch.setattr("app.modules.research.routes.citations_service.create_citation", fake_create_citation)

    payload = CitationCreateRequest.model_validate(
        {
            "extraction_payload": _canonical_extraction_payload(),
            "excerpt": "Quoted sentence",
            "quote": "Quoted sentence",
            "locator": {"paragraph": 4},
            "style": "mla",
        }
    )
    response = await create_citation(payload, access=_access_context())

    assert response["ok"] is True
    assert response["data"]["id"] == "citation-1"
    assert captured["user_id"] == "user-1"
    assert captured["account_type"] == "pro"
    assert captured["extraction_payload"].canonical_url == "https://example.com/paper"
    assert captured["extraction_payload"].identifiers["doi"] == "10.1000/example-doi"
    assert captured["extraction_payload"].container_candidates[0].value == "Journal of Analytical Engines"


@pytest.mark.anyio
async def test_citation_preview_handler_accepts_canonical_extraction_payload(monkeypatch):
    captured = {}

    async def fake_preview_citation(
        *,
        account_type,
        extraction_payload,
        excerpt,
        locator,
        annotation,
        quote,
        style,
    ):
        captured["account_type"] = account_type
        captured["extraction_payload"] = extraction_payload
        captured["excerpt"] = excerpt
        captured["locator"] = locator
        captured["annotation"] = annotation
        captured["quote"] = quote
        captured["style"] = style
        return {
            "citation": {
                "id": None,
                "source_id": None,
                "source": {"title": "Paper title"},
                "locator": {"paragraph": 4},
                "annotation": None,
                "excerpt": "Quoted sentence",
                "quote_text": "Quoted sentence",
                "renders": {"mla": {"quote_attribution": "\"Quoted sentence\" (Lovelace, par. 4)"}},
                "created_at": None,
                "updated_at": None,
                "relationship_counts": {},
            },
            "render_bundle": {
                "renders": {"mla": {"quote_attribution": "\"Quoted sentence\" (Lovelace, par. 4)"}},
            },
            "selected_style": "mla",
        }

    monkeypatch.setattr("app.modules.research.routes.citations_service.preview_citation", fake_preview_citation)

    payload = CitationPreviewRequest.model_validate(
        {
            "extraction_payload": _canonical_extraction_payload(),
            "excerpt": "Quoted sentence",
            "quote": "Quoted sentence",
            "locator": {"paragraph": 4},
            "style": "mla",
        }
    )
    response = await preview_citation(payload, access=_access_context())

    assert response["ok"] is True
    assert response["data"]["citation"]["id"] is None
    assert response["data"]["selected_style"] == "mla"
    assert captured["account_type"] == "pro"
    assert captured["extraction_payload"].canonical_url == "https://example.com/paper"
    assert captured["extraction_payload"].identifiers["doi"] == "10.1000/example-doi"
    assert captured["extraction_payload"].container_candidates[0].value == "Journal of Analytical Engines"
