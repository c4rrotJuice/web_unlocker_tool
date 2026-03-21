from __future__ import annotations

from typing import Any

from app.services.citation_domain import (
    SUPPORTED_STYLES,
    build_source_fingerprint,
    compute_source_version,
    generate_render_bundle as _generate_render_bundle,
    render_citation,
)


def normalize_metadata(source: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    context = context or {}
    return {
        **(source.get("metadata") or {}),
        "url": source.get("canonical_url") or source.get("page_url"),
        "title": source.get("title"),
        "title_case": source.get("title_case"),
        "sentence_case": source.get("sentence_case"),
        "siteName": source.get("site_name"),
        "publisher": source.get("publisher"),
        "authors": source.get("authors"),
        "author": source.get("author"),
        "datePublished": (source.get("issued") or {}).get("raw"),
        "dateAccessed": (source.get("metadata") or {}).get("dateAccessed"),
        "paragraph": (context.get("locator") or {}).get("paragraph"),
        "excerpt": context.get("excerpt"),
        "source_fingerprint": source.get("fingerprint"),
        "source_version": source.get("source_version"),
        "metadata_schema_version": source.get("metadata_schema_version"),
        "source": {
            "fingerprint": source.get("fingerprint"),
            "version": source.get("source_version"),
            "metadata": {
                "title": source.get("title"),
                "authors": source.get("authors"),
                "publisher": source.get("publisher"),
                "siteName": source.get("site_name"),
                "datePublished": (source.get("issued") or {}).get("raw"),
                "url": source.get("canonical_url") or source.get("page_url"),
                "doi": (source.get("identifiers") or {}).get("doi"),
            },
        },
        "quote": {
            "selected_text": context.get("quote"),
            "short_excerpt": (context.get("quote") or "")[:280],
            "locator": context.get("locator") or {},
        },
    }


def generate_citation_outputs(style: str, source: dict[str, Any], context: dict[str, Any]) -> dict[str, str]:
    return {
        "inline_citation": render_citation(source, context, style=style, render_kind="inline"),
        "full_citation": render_citation(source, context, style=style, render_kind="bibliography"),
    }


def generate_render_bundle(source: dict[str, Any], context: dict[str, Any], styles: list[str] | None = None) -> dict[str, Any]:
    return _generate_render_bundle(source, context, styles=styles, render_kinds=["inline", "bibliography"])
