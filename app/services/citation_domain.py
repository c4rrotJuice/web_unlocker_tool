from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field


SUPPORTED_STYLES = {"mla", "apa", "chicago", "harvard"}
SUPPORTED_RENDER_KINDS = {"inline", "bibliography", "footnote", "quote_attribution"}
NORMALIZATION_VERSION = 1
RENDER_VERSION = 1
METADATA_SCHEMA_VERSION = 3

INSTITUTION_EQUIVALENTS = {
    "who": "World Health Organization",
    "world health organization": "World Health Organization",
    "w.h.o.": "World Health Organization",
}

PUBLISHER_EQUIVALENTS = {
    "who": "World Health Organization",
    "world health organisation": "World Health Organization",
    "w.h.o.": "World Health Organization",
}


class ExtractionCandidate(BaseModel):
    value: str
    confidence: float = 0.5
    source: str | None = None


class ExtractionPayload(BaseModel):
    identifiers: dict[str, Any] = Field(default_factory=dict)
    canonical_url: str | None = None
    page_url: str | None = None
    title_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    author_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    date_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    publisher_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    container_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    source_type_candidates: list[ExtractionCandidate] = Field(default_factory=list)
    selection_text: str | None = None
    locator: dict[str, Any] = Field(default_factory=dict)
    extraction_evidence: dict[str, Any] = Field(default_factory=dict)
    raw_metadata: dict[str, Any] = Field(default_factory=dict)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower().replace("www.", "")
    except Exception:  # noqa: BLE001
        return ""
    return host


def _canonical_url(url: str) -> str:
    cleaned = _clean(url)
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if not parsed.scheme or not parsed.netloc:
        return cleaned
    fragmentless = parsed._replace(fragment="")
    return fragmentless.geturl().rstrip("/")


def _title_case(value: str) -> str:
    value = _clean(value)
    if not value:
        return "Untitled page"
    return " ".join(part[:1].upper() + part[1:] for part in value.split(" "))


def _sentence_case(value: str) -> str:
    value = _clean(value)
    if not value:
        return "Untitled page"
    return value[:1].upper() + value[1:]


def _normalize_org_name(value: str) -> str:
    cleaned = _clean(value)
    if not cleaned:
        return ""
    return PUBLISHER_EQUIVALENTS.get(cleaned.lower(), cleaned)


def _parse_year(value: str) -> str:
    text = _clean(value)
    if not text:
        return "n.d."
    match = re.search(r"(19|20)\d{2}", text)
    return match.group(0) if match else "n.d."


def _normalize_source_type(value: str) -> str:
    cleaned = _clean(value).lower()
    if not cleaned:
        return "webpage"
    if cleaned in {"journal article", "article", "scholarly article"}:
        return "journal_article"
    if cleaned in {"book", "dataset", "website", "webpage", "report"}:
        return cleaned.replace("website", "webpage").replace(" ", "_")
    return cleaned.replace(" ", "_")


def _candidate_value(candidates: list[ExtractionCandidate], fallback: str = "") -> str:
    best = ""
    best_confidence = -1.0
    for candidate in candidates:
        value = _clean(candidate.value)
        if not value:
            continue
        if candidate.confidence > best_confidence:
            best = value
            best_confidence = candidate.confidence
    return best or _clean(fallback)


def _is_canonical_extraction_payload(payload: dict[str, Any]) -> bool:
    return any(
        key in payload
        for key in (
            "identifiers",
            "canonical_url",
            "page_url",
            "title_candidates",
            "author_candidates",
            "date_candidates",
            "publisher_candidates",
            "container_candidates",
            "source_type_candidates",
            "selection_text",
            "locator",
            "extraction_evidence",
            "raw_metadata",
        )
    )


def _parse_author_object(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        full = _clean(raw.get("fullName") or raw.get("name") or raw.get("author"))
    else:
        full = _clean(raw)

    if not full:
        return None

    normalized = INSTITUTION_EQUIVALENTS.get(full.lower(), full)
    parts = normalized.split()
    is_org = len(parts) == 1 or any(
        word.lower() in {"organization", "agency", "association", "department", "institute"}
        for word in parts
    )

    if is_org:
        return {
            "fullName": normalized,
            "firstName": "",
            "lastName": normalized,
            "initials": "",
            "isOrganization": True,
        }

    first = parts[0]
    last = parts[-1]
    initials = "".join(part[:1].upper() for part in parts[:-1])
    return {
        "fullName": normalized,
        "firstName": first,
        "lastName": last,
        "initials": initials,
        "isOrganization": False,
    }


def _normalize_authors(author_candidates: list[ExtractionCandidate], raw_metadata: dict[str, Any], site_name: str) -> list[dict[str, Any]]:
    raw_authors: list[Any] = []
    if author_candidates:
        raw_authors.extend(candidate.value for candidate in author_candidates if _clean(candidate.value))

    metadata_authors = raw_metadata.get("authors")
    if isinstance(metadata_authors, list):
        raw_authors.extend(metadata_authors)

    if not raw_authors:
        raw_authors.extend(
            value
            for value in [
                raw_metadata.get("author"),
                raw_metadata.get("creator"),
                raw_metadata.get("publisher"),
                site_name,
            ]
            if value
        )

    authors: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_authors:
        parsed = _parse_author_object(raw)
        if not parsed:
            continue
        key = parsed["fullName"].lower()
        if key in seen:
            continue
        if key == _clean(site_name).lower() and len(raw_authors) > 1:
            continue
        seen.add(key)
        authors.append(parsed)

    return authors


def build_source_fingerprint(source: dict[str, Any]) -> str:
    identifiers = source.get("identifiers") or {}
    doi = _clean(identifiers.get("doi") or source.get("doi"))
    if doi:
        return f"doi:{doi.lower().replace('https://doi.org/', '').replace('http://doi.org/', '')}"

    canonical_url = _canonical_url(source.get("canonical_url") or source.get("url") or "")
    if canonical_url:
        return f"url:{canonical_url.lower()}"

    title = _clean(source.get("title")).lower()
    authors = ",".join(_clean((author or {}).get("fullName")).lower() for author in (source.get("authors") or []))
    year = _parse_year(_clean((source.get("issued") or {}).get("raw") or source.get("datePublished") or ""))
    source_type = _clean(source.get("source_type")).lower()
    digest = hashlib.sha1(f"{title}|{authors}|{year}|{source_type}".encode("utf-8")).hexdigest()  # noqa: S324
    return f"meta:{digest}"


def compute_source_version(source: dict[str, Any]) -> str:
    issued = source.get("issued") or {}
    canonical = {
        "title": _clean(source.get("title")),
        "authors": [
            _clean((item or {}).get("fullName"))
            for item in (source.get("authors") or [])
            if _clean((item or {}).get("fullName"))
        ],
        "container_title": _clean(source.get("container_title")),
        "publisher": _normalize_org_name(_clean(source.get("publisher"))),
        "source_type": _normalize_source_type(source.get("source_type") or "webpage"),
        "issued_raw": _clean(issued.get("raw")),
        "canonical_url": _canonical_url(_clean(source.get("canonical_url") or source.get("url"))),
        "identifiers": source.get("identifiers") or {},
    }
    payload = "|".join(
        [
            canonical["title"],
            ",".join(canonical["authors"]),
            canonical["container_title"],
            canonical["publisher"],
            canonical["source_type"],
            canonical["issued_raw"],
            canonical["canonical_url"],
            _clean(canonical["identifiers"].get("doi")),
            _clean(canonical["identifiers"].get("isbn")),
        ],
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()  # noqa: S324


def compute_citation_version(context: dict[str, Any]) -> str:
    locator = context.get("locator") or {}
    payload = "|".join(
        [
            _clean(context.get("quote")),
            _clean(context.get("excerpt")),
            _clean(context.get("annotation")),
            _clean(locator.get("page")),
            _clean(locator.get("paragraph")),
            _clean(locator.get("section")),
        ],
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()  # noqa: S324


def normalize_citation_payload(payload: ExtractionPayload | dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload, dict) and not _is_canonical_extraction_payload(payload):
        raise ValueError("canonical extraction payload required")
    extracted = payload if isinstance(payload, ExtractionPayload) else ExtractionPayload.model_validate(payload)
    raw = dict(extracted.raw_metadata or {})

    page_url = _canonical_url(extracted.page_url or raw.get("page_url") or "")
    canonical_url = _canonical_url(extracted.canonical_url or page_url)
    site_name = _normalize_org_name(
        _candidate_value(extracted.publisher_candidates, raw.get("siteName") or raw.get("site_name") or raw.get("publisher") or _domain(canonical_url))
    )
    title = _candidate_value(extracted.title_candidates, raw.get("title") or raw.get("headline") or "Untitled Page") or "Untitled Page"
    authors = _normalize_authors(extracted.author_candidates, raw, site_name)
    lead_author = authors[0] if authors else _parse_author_object(site_name)
    date_raw = _candidate_value(extracted.date_candidates, raw.get("datePublished") or raw.get("date") or raw.get("year"))
    year = _parse_year(date_raw)
    source_type = _normalize_source_type(_candidate_value(extracted.source_type_candidates, raw.get("source_type") or raw.get("@type") or "webpage"))
    container_title = _candidate_value(extracted.container_candidates, raw.get("container_title") or raw.get("journalTitle") or raw.get("journal_title"))
    publisher = _normalize_org_name(_candidate_value(extracted.publisher_candidates, raw.get("publisher") or site_name)) or site_name

    locator = dict(extracted.locator or {})
    paragraph = locator.get("paragraph")
    if paragraph and str(paragraph).isdigit():
        locator["paragraph"] = int(paragraph)

    issued = {
        "raw": date_raw,
        "year": None if year == "n.d." else int(year),
    }

    source = {
        "title": title,
        "title_case": _title_case(title),
        "sentence_case": _sentence_case(title),
        "source_type": source_type,
        "authors": authors,
        "author": lead_author["fullName"] if lead_author else site_name,
        "container_title": container_title,
        "publisher": publisher,
        "site_name": site_name,
        "issued": issued,
        "identifiers": {key.lower(): value for key, value in (extracted.identifiers or {}).items() if _clean(value)},
        "canonical_url": canonical_url,
        "page_url": page_url or canonical_url,
        "metadata": raw,
        "raw_extraction": extracted.model_dump(mode="json"),
        "normalization_version": NORMALIZATION_VERSION,
        "metadata_schema_version": METADATA_SCHEMA_VERSION,
    }
    source["fingerprint"] = build_source_fingerprint(source)
    source["source_version"] = compute_source_version(source)

    context = {
        "quote": _clean(raw.get("quote") or extracted.selection_text or raw.get("selected_text") or ""),
        "excerpt": _clean(raw.get("excerpt") or extracted.selection_text or ""),
        "annotation": _clean(raw.get("annotation") or ""),
        "locator": locator,
    }
    context["citation_version"] = compute_citation_version(context)

    return {
        "source": source,
        "context": context,
        "render_cache_key_prefix": f"{source['source_version']}:{context['citation_version']}",
    }


def _authors_for_style(authors: list[dict[str, Any]], style: str) -> str:
    if not authors:
        return ""
    mapped = []
    for author in authors:
        if author.get("isOrganization"):
            mapped.append(author["fullName"])
        elif style in {"apa", "harvard"}:
            initials = " ".join(f"{character}." for character in (author.get("initials") or ""))
            mapped.append(f"{author.get('lastName')}, {initials}".strip().rstrip(","))
        else:
            mapped.append(f"{author.get('lastName')}, {author.get('firstName')}".strip().rstrip(","))
    if len(mapped) == 1:
        return mapped[0]
    return f"{mapped[0]} et al."


def render_citation(source: dict[str, Any], context: dict[str, Any], *, style: str, render_kind: str) -> str:
    normalized_style = (style or "mla").strip().lower()
    normalized_kind = (render_kind or "bibliography").strip().lower()
    if normalized_style not in SUPPORTED_STYLES:
        normalized_style = "mla"
    if normalized_kind not in SUPPORTED_RENDER_KINDS:
        normalized_kind = "bibliography"

    authors = source.get("authors") or []
    author_obj = authors[0] if authors else _parse_author_object(source.get("author") or source.get("site_name"))
    author_last = author_obj.get("lastName") if author_obj else source.get("site_name") or "Source"
    author_text = _authors_for_style(authors, normalized_style) or source.get("author") or source.get("site_name") or "Source"
    year = _parse_year((source.get("issued") or {}).get("raw"))
    paragraph = (context.get("locator") or {}).get("paragraph")
    page = (context.get("locator") or {}).get("page")
    locator_suffix = f", p. {page}" if page else f", para. {paragraph}" if paragraph else ""

    if normalized_kind == "inline":
        if normalized_style == "mla":
            locator = f", par. {paragraph}" if paragraph else f", {page}" if page else ""
            return f"({author_last}{locator})"
        return f"({author_last}, {year}{locator_suffix})"

    if normalized_kind == "footnote":
        base = render_citation(source, context, style=normalized_style, render_kind="bibliography").rstrip(".")
        quote = context.get("quote")
        if quote:
            return f"{base}, quote: \"{quote}\"."
        return f"{base}."

    if normalized_kind == "quote_attribution":
        inline = render_citation(source, context, style=normalized_style, render_kind="inline")
        quote = context.get("quote") or context.get("excerpt")
        if quote:
            return f"\"{quote}\" {inline}"
        return inline

    title_case = source.get("title_case") or _title_case(source.get("title"))
    sentence_case = source.get("sentence_case") or _sentence_case(source.get("title"))
    container = source.get("container_title") or source.get("site_name")
    publisher = source.get("publisher") or source.get("site_name")
    canonical_url = source.get("canonical_url") or source.get("page_url") or ""

    if normalized_style == "mla":
        return f"{author_text}. \"{title_case}.\" *{container or publisher}*, {year}, {canonical_url}."
    if normalized_style == "chicago":
        return f"{author_text}. \"{title_case}.\" {container or publisher}. {canonical_url}."
    if normalized_style == "harvard":
        return f"{author_text} ({year}) {sentence_case}. {container or publisher}. Available at: {canonical_url}."
    return f"{author_text}. ({year}). {sentence_case}. {container or publisher}. {canonical_url}"


def generate_render_bundle(
    source: dict[str, Any],
    context: dict[str, Any],
    *,
    styles: list[str] | None = None,
    render_kinds: list[str] | None = None,
) -> dict[str, Any]:
    selected_styles = styles or sorted(SUPPORTED_STYLES)
    selected_kinds = render_kinds or ["inline", "bibliography", "footnote", "quote_attribution"]
    renders: dict[str, dict[str, str]] = {}
    for style in selected_styles:
        if style not in SUPPORTED_STYLES:
            continue
        renders[style] = {}
        for render_kind in selected_kinds:
            if render_kind not in SUPPORTED_RENDER_KINDS:
                continue
            renders[style][render_kind] = render_citation(source, context, style=style, render_kind=render_kind)
    return {
        "source_fingerprint": source.get("fingerprint"),
        "source_version": source.get("source_version"),
        "citation_version": context.get("citation_version"),
        "render_version": RENDER_VERSION,
        "source": source,
        "context": context,
        "renders": renders,
    }


def build_api_citation_record(
    citation_instance: dict[str, Any],
    source: dict[str, Any],
    render_bundle: dict[str, Any] | None = None,
    *,
    preferred_style: str | None = None,
) -> dict[str, Any]:
    style = (preferred_style or citation_instance.get("style") or "mla").lower()
    bundle = render_bundle or generate_render_bundle(source, citation_instance.get("context") or {}, styles=[style])
    renders = bundle.get("renders", {}).get(style, {})
    context = citation_instance.get("context") or {}
    metadata = {
        **(source.get("metadata") or {}),
        "title": source.get("title"),
        "author": source.get("author"),
        "authors": source.get("authors"),
        "siteName": source.get("site_name"),
        "publisher": source.get("publisher"),
        "container_title": source.get("container_title"),
        "source_type": source.get("source_type"),
        "datePublished": (source.get("issued") or {}).get("raw"),
        "url": source.get("canonical_url") or source.get("page_url"),
        "source_fingerprint": source.get("fingerprint"),
        "source_version": source.get("source_version"),
    }
    return {
        "id": citation_instance.get("id"),
        "source_id": citation_instance.get("source_id"),
        "url": source.get("canonical_url") or source.get("page_url"),
        "excerpt": context.get("excerpt") or context.get("quote") or "",
        "quote": context.get("quote") or "",
        "locator": context.get("locator") or {},
        "annotation": context.get("annotation") or "",
        "format": style,
        "style": style,
        "metadata": metadata,
        "source": source,
        "context": context,
        "inline_citation": renders.get("inline") or render_citation(source, context, style=style, render_kind="inline"),
        "full_citation": renders.get("bibliography") or render_citation(source, context, style=style, render_kind="bibliography"),
        "full_text": renders.get("bibliography") or render_citation(source, context, style=style, render_kind="bibliography"),
        "footnote": renders.get("footnote") or render_citation(source, context, style=style, render_kind="footnote"),
        "quote_attribution": renders.get("quote_attribution") or render_citation(source, context, style=style, render_kind="quote_attribution"),
        "source_fingerprint": source.get("fingerprint"),
        "source_version": source.get("source_version"),
        "citation_version": context.get("citation_version"),
        "render_version": RENDER_VERSION,
        "cited_at": citation_instance.get("created_at") or citation_instance.get("cited_at") or datetime.now(timezone.utc).isoformat(),
    }
