from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field


SUPPORTED_STYLES = {"mla", "apa", "chicago", "harvard"}
SUPPORTED_RENDER_KINDS = {"inline", "bibliography", "footnote", "quote_attribution"}
NORMALIZATION_VERSION = 2
RENDER_VERSION = 1
METADATA_SCHEMA_VERSION = 4

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

PERSON_AUTHOR_DELIMITERS = re.compile(r"\s*(?:;|\|)\s*")
ORG_HINTS = {
    "academy",
    "agency",
    "association",
    "center",
    "centre",
    "college",
    "commission",
    "committee",
    "company",
    "council",
    "department",
    "foundation",
    "group",
    "institute",
    "journal",
    "lab",
    "laboratory",
    "ministry",
    "office",
    "organization",
    "organisation",
    "press",
    "project",
    "publisher",
    "school",
    "society",
    "team",
    "university",
}


class ExtractionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    confidence: float = 0.5
    source: str | None = None


class ExtractionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

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


def _clean_lower(value: Any) -> str:
    return _clean(value).lower()


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


def _normalize_page_url(url: str) -> str:
    cleaned = _clean(url)
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if not parsed.scheme or not parsed.netloc:
        return cleaned
    return parsed._replace(fragment="").geturl()


def _normalize_doi(value: Any) -> str:
    text = _clean(value)
    if not text:
        return ""
    normalized = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", text, flags=re.IGNORECASE)
    normalized = re.sub(r"^doi:\s*", "", normalized, flags=re.IGNORECASE)
    normalized = normalized.strip().rstrip(".;,)")
    return normalized.lower()


def _normalize_isbn(value: Any) -> str:
    text = _clean(value)
    if not text:
        return ""
    return re.sub(r"[^0-9Xx]", "", text).upper()


def _normalize_issn(value: Any) -> str:
    text = _clean(value)
    if not text:
        return ""
    digits = re.sub(r"[^0-9Xx]", "", text).upper()
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:]}"
    return digits


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
    if cleaned in {"journal article", "scholarly article", "scholarlyarticle"}:
        return "journal_article"
    if cleaned in {"article", "news article", "newsarticle"}:
        return "article"
    if cleaned in {"book", "dataset", "website", "webpage", "report"}:
        return cleaned.replace("website", "webpage").replace(" ", "_")
    return cleaned.replace(" ", "_")


def _source_priority(source: str | None) -> int:
    normalized = _clean_lower(source)
    if not normalized:
        return 10
    if "doi" in normalized and ("meta:" in normalized or normalized.startswith("jsonld:")):
        return 120
    if "citation_" in normalized or "highwire" in normalized:
        return 110
    if "dc." in normalized or "dcterms." in normalized or "prism." in normalized:
        return 100
    if normalized.startswith("jsonld:"):
        return 90
    if normalized.startswith("meta:property:article:") or normalized.startswith("meta:name:author") or normalized.startswith("meta:property:og:"):
        return 70
    if normalized.startswith("meta:"):
        return 65
    if normalized.startswith("dom:time") or normalized.startswith("dom:"):
        return 40
    if normalized.startswith("page.site_name") or normalized.startswith("page.domain"):
        return 20
    if normalized.startswith("extension.capture"):
        return 5
    return 30


def _candidate_sort_key(candidate: ExtractionCandidate) -> tuple[int, float, int, str]:
    value = _clean(candidate.value)
    return (_source_priority(candidate.source), candidate.confidence, len(value), value.lower())


def _sorted_candidates(candidates: list[ExtractionCandidate]) -> list[ExtractionCandidate]:
    usable = [candidate for candidate in candidates if _clean(candidate.value)]
    return sorted(usable, key=_candidate_sort_key, reverse=True)


def _candidate_value(candidates: list[ExtractionCandidate], fallback: str = "") -> str:
    ordered = _sorted_candidates(candidates)
    return _clean(ordered[0].value if ordered else fallback)


def _candidate_values(candidates: list[ExtractionCandidate]) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for candidate in _sorted_candidates(candidates):
        value = _clean(candidate.value)
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        values.append(value)
    return values


def _parse_date_parts(value: Any) -> dict[str, Any]:
    text = _clean(value)
    if not text:
        return {}
    parsed: datetime | None = None
    normalized = text
    iso_match = re.match(r"^\s*(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?", text)
    if iso_match:
        year = int(iso_match.group(1))
        month = int(iso_match.group(2)) if iso_match.group(2) else None
        day = int(iso_match.group(3)) if iso_match.group(3) else None
        payload: dict[str, Any] = {"raw": text, "year": year}
        if month:
            payload["month"] = month
        if day:
            payload["day"] = day
        if month and day:
            payload["iso"] = f"{year:04d}-{month:02d}-{day:02d}"
        elif month:
            payload["iso"] = f"{year:04d}-{month:02d}"
        else:
            payload["iso"] = f"{year:04d}"
        return payload
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is None:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            parsed = None
    if parsed is not None:
        payload = {
            "raw": text,
            "year": parsed.year,
            "month": parsed.month,
            "day": parsed.day,
            "iso": parsed.date().isoformat(),
        }
        return payload
    year = _parse_year(text)
    if year != "n.d.":
        return {"raw": text, "year": int(year), "iso": year}
    return {"raw": text, "year": None}


def _is_probable_organization(value: str) -> bool:
    normalized = _clean(value)
    if not normalized:
        return False
    lower = normalized.lower()
    if lower in INSTITUTION_EQUIVALENTS or lower in PUBLISHER_EQUIVALENTS:
        return True
    parts = [part.strip(".,()").lower() for part in normalized.split()]
    if len(parts) == 1 and parts[0].isupper():
        return True
    return any(part in ORG_HINTS for part in parts)


def _split_author_string(value: Any) -> list[str]:
    text = _clean(value)
    if not text:
        return []
    if PERSON_AUTHOR_DELIMITERS.search(text):
        return [part for part in PERSON_AUTHOR_DELIMITERS.split(text) if _clean(part)]
    if " and " in text.lower() and "," not in text:
        return [_clean(part) for part in re.split(r"\s+(?:and|&)\s+", text, flags=re.IGNORECASE) if _clean(part)]
    return [text]


def _parse_author_object(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        full = _clean(raw.get("fullName") or raw.get("name") or raw.get("author"))
    else:
        full = _clean(raw)

    if not full:
        return None

    normalized = INSTITUTION_EQUIVALENTS.get(full.lower(), full)
    if _is_probable_organization(normalized):
        return {
            "fullName": normalized,
            "firstName": "",
            "lastName": normalized,
            "initials": "",
            "isOrganization": True,
        }

    comma_parts = [part.strip() for part in normalized.split(",", 1)]
    if len(comma_parts) == 2 and comma_parts[0] and comma_parts[1]:
        last = comma_parts[0]
        given = comma_parts[1]
        given_parts = [part for part in given.split() if part]
        full_name = f"{given} {last}".strip()
        initials = "".join(part[:1].upper() for part in given_parts)
        return {
            "fullName": full_name,
            "firstName": given_parts[0] if given_parts else given,
            "lastName": last,
            "initials": initials,
            "isOrganization": False,
        }

    parts = [part for part in normalized.split() if part]
    if len(parts) == 1:
        return {
            "fullName": normalized,
            "firstName": parts[0],
            "lastName": parts[0],
            "initials": parts[0][:1].upper(),
            "isOrganization": False,
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


def _author_fallbacks(raw_metadata: dict[str, Any]) -> list[Any]:
    authors: list[Any] = []
    metadata_authors = raw_metadata.get("authors")
    if isinstance(metadata_authors, list):
        authors.extend(metadata_authors)
    for key in ("author", "creator"):
        value = raw_metadata.get(key)
        if value:
            authors.append(value)
    return authors


def _normalize_authors(
    author_candidates: list[ExtractionCandidate],
    raw_metadata: dict[str, Any],
    *,
    site_name: str,
    publisher: str,
    source_type: str,
) -> list[dict[str, Any]]:
    raw_authors: list[Any] = []
    for candidate in _sorted_candidates(author_candidates):
        raw_authors.extend(_split_author_string(candidate.value))
    for raw in _author_fallbacks(raw_metadata):
        if isinstance(raw, list):
            for item in raw:
                raw_authors.extend(_split_author_string(item))
        else:
            raw_authors.extend(_split_author_string(raw))

    authors: list[dict[str, Any]] = []
    seen: set[str] = set()
    site_lower = _clean_lower(site_name)
    publisher_lower = _clean_lower(publisher)
    for raw in raw_authors:
        parsed = _parse_author_object(raw)
        if not parsed:
            continue
        key = parsed["fullName"].lower()
        if key in seen:
            continue
        if not parsed["isOrganization"] and key in {site_lower, publisher_lower}:
            continue
        seen.add(key)
        authors.append(parsed)

    if authors:
        return authors

    fallback_org = publisher or site_name
    if source_type in {"report", "dataset"} and _is_probable_organization(fallback_org):
        parsed = _parse_author_object(fallback_org)
        return [parsed] if parsed else []
    return []


def _normalize_identifiers(payload: ExtractionPayload, raw_metadata: dict[str, Any]) -> dict[str, str]:
    identifiers: dict[str, str] = {}
    raw_inputs = dict(payload.identifiers or {})
    if isinstance(raw_metadata.get("identifiers"), dict):
        raw_inputs = {**raw_metadata.get("identifiers"), **raw_inputs}
    raw_inputs.setdefault("doi", raw_metadata.get("doi"))
    raw_inputs.setdefault("isbn", raw_metadata.get("isbn"))
    raw_inputs.setdefault("issn", raw_metadata.get("issn"))
    raw_inputs.setdefault("pdf_url", raw_metadata.get("pdf_url"))

    doi = _normalize_doi(raw_inputs.get("doi"))
    isbn = _normalize_isbn(raw_inputs.get("isbn"))
    issn = _normalize_issn(raw_inputs.get("issn"))
    pdf_url = _canonical_url(raw_inputs.get("pdf_url") or "")
    if doi:
        identifiers["doi"] = doi
    if isbn:
        identifiers["isbn"] = isbn
    if issn:
        identifiers["issn"] = issn
    if pdf_url:
        identifiers["pdf_url"] = pdf_url
    return identifiers


def _infer_source_type(
    source_type_candidates: list[ExtractionCandidate],
    *,
    identifiers: dict[str, str],
    container_title: str,
    raw_metadata: dict[str, Any],
) -> str:
    for candidate in _sorted_candidates(source_type_candidates):
        normalized = _normalize_source_type(candidate.value)
        if normalized in {"journal_article", "article", "report", "book", "dataset", "webpage"}:
            return normalized
    raw_type = _normalize_source_type(raw_metadata.get("source_type") or raw_metadata.get("@type") or "")
    if raw_type in {"journal_article", "article", "report", "book", "dataset", "webpage"}:
        return raw_type
    if identifiers.get("doi") and container_title:
        return "journal_article"
    if container_title and any(_clean(raw_metadata.get(key)) for key in ("volume", "issue", "first_page", "last_page", "pages")):
        return "journal_article"
    return "webpage"


def build_source_fingerprint(source: dict[str, Any]) -> str:
    identifiers = source.get("identifiers") or {}
    doi = _normalize_doi(identifiers.get("doi") or source.get("doi"))
    if doi:
        return f"doi:{doi}"

    isbn = _normalize_isbn(identifiers.get("isbn") or source.get("isbn"))
    if isbn:
        return f"isbn:{isbn}"

    canonical_url = _canonical_url(source.get("canonical_url") or source.get("url") or "")
    if canonical_url:
        return f"url:{canonical_url.lower()}"

    title = _clean(source.get("title")).lower()
    authors = ",".join(_clean((author or {}).get("fullName")).lower() for author in (source.get("authors") or []))
    year = _parse_year(_clean((source.get("issued") or {}).get("raw") or source.get("datePublished") or ""))
    source_type = _clean(source.get("source_type")).lower()
    container = _clean(source.get("container_title")).lower()
    publisher = _clean(source.get("publisher") or source.get("site_name")).lower()
    digest = hashlib.sha1(f"{title}|{authors}|{year}|{source_type}|{container}|{publisher}".encode("utf-8")).hexdigest()  # noqa: S324
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
            _normalize_doi(canonical["identifiers"].get("doi")),
            _normalize_isbn(canonical["identifiers"].get("isbn")),
            _normalize_issn(canonical["identifiers"].get("issn")),
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


def normalize_citation_payload(payload: ExtractionPayload) -> dict[str, Any]:
    raw = dict(payload.raw_metadata or {})
    page_url = _normalize_page_url(payload.page_url or raw.get("page_url") or "")
    canonical_url = _canonical_url(payload.canonical_url or raw.get("canonical_url") or page_url)
    identifiers = _normalize_identifiers(payload, raw)
    title = _candidate_value(payload.title_candidates, raw.get("title") or raw.get("headline") or "Untitled Page") or "Untitled Page"
    container_title = _candidate_value(
        payload.container_candidates,
        raw.get("container_title") or raw.get("journalTitle") or raw.get("journal_title"),
    )
    site_name = _normalize_org_name(
        _candidate_value(payload.publisher_candidates, raw.get("siteName") or raw.get("site_name") or _domain(canonical_url or page_url))
    )
    publisher = _normalize_org_name(_candidate_value(payload.publisher_candidates, raw.get("publisher") or site_name)) or site_name
    source_type = _infer_source_type(
        payload.source_type_candidates,
        identifiers=identifiers,
        container_title=container_title,
        raw_metadata=raw,
    )
    authors = _normalize_authors(
        payload.author_candidates,
        raw,
        site_name=site_name,
        publisher=publisher,
        source_type=source_type,
    )
    lead_author = authors[0] if authors else None
    explicit_author_inputs = bool(_sorted_candidates(payload.author_candidates)) or bool(_author_fallbacks(raw))

    issued_raw = _candidate_value(payload.date_candidates, raw.get("datePublished") or raw.get("date") or raw.get("year"))
    modified_raw = _clean(raw.get("dateModified") or raw.get("modified") or raw.get("lastModified"))
    accessed_raw = _clean(raw.get("accessed") or raw.get("accessed_at"))
    issued = _parse_date_parts(issued_raw) if issued_raw else {}
    if "year" not in issued:
        issued["year"] = None
    issued.setdefault("raw", issued_raw)
    modified = _parse_date_parts(modified_raw) if modified_raw else {}
    accessed = _parse_date_parts(accessed_raw) if accessed_raw else {}
    date_resolution = "explicit" if issued_raw else "missing"
    if authors:
        author_resolution = "explicit" if explicit_author_inputs else "organization_fallback"
    else:
        author_resolution = "missing"

    locator = dict(payload.locator or {})
    paragraph = locator.get("paragraph")
    if paragraph and str(paragraph).isdigit():
        locator["paragraph"] = int(paragraph)
    metadata = {
        **raw,
        "title": title,
        "authors": [author["fullName"] for author in authors],
        "author": lead_author["fullName"] if lead_author else None,
        "site_name": site_name or None,
        "publisher": publisher or None,
        "container_title": container_title or None,
        "source_type": source_type,
        "datePublished": issued.get("raw"),
        "dateModified": modified.get("raw"),
        "accessed": accessed.get("raw"),
        "canonical_url": canonical_url or None,
        "page_url": page_url or canonical_url or None,
        "language": _clean(raw.get("language") or raw.get("inLanguage") or ""),
        "description": _clean(raw.get("description")),
        "hostname": _domain(canonical_url or page_url),
    }
    for field in ("volume", "issue", "first_page", "last_page", "pages"):
        value = _clean(raw.get(field) or raw.get(field.replace("_", "")))
        if value:
            metadata[field] = value
    if modified:
        metadata["modified_date"] = modified
    if accessed:
        metadata["accessed_date"] = accessed
    metadata["author_resolution"] = author_resolution
    metadata["date_resolution"] = date_resolution
    metadata["limited_metadata"] = bool(
        not authors
        or not issued_raw
        or (not identifiers.get("doi") and not container_title and not publisher)
    )

    source = {
        "title": title,
        "title_case": _title_case(title),
        "sentence_case": _sentence_case(title),
        "source_type": source_type,
        "authors": authors,
        "author": lead_author["fullName"] if lead_author else "",
        "container_title": container_title,
        "publisher": publisher,
        "site_name": site_name,
        "issued": issued,
        "identifiers": identifiers,
        "canonical_url": canonical_url,
        "page_url": page_url or canonical_url,
        "metadata": metadata,
        "raw_extraction": payload.model_dump(mode="json"),
        "normalization_version": NORMALIZATION_VERSION,
        "metadata_schema_version": METADATA_SCHEMA_VERSION,
    }
    source["fingerprint"] = build_source_fingerprint(source)
    source["source_version"] = compute_source_version(source)

    context = {
        "quote": _clean(raw.get("quote") or payload.selection_text or raw.get("selected_text") or ""),
        "excerpt": _clean(raw.get("excerpt") or payload.selection_text or ""),
        "annotation": _clean(raw.get("annotation") or ""),
        "locator": locator,
    }
    context["citation_version"] = compute_citation_version(context)

    return {
        "source": source,
        "context": context,
        "render_cache_key_prefix": f"{source['source_version']}:{context['citation_version']}",
    }


MONTH_NAMES = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}


def _initials_with_periods(initials: str) -> str:
    return " ".join(f"{character}." for character in (initials or ""))


def _author_bib_name(author: dict[str, Any], *, style: str, invert: bool) -> str:
    if author.get("isOrganization"):
        return author.get("fullName") or "Source"
    first = _clean(author.get("firstName"))
    last = _clean(author.get("lastName")) or _clean(author.get("fullName")) or "Source"
    initials = _initials_with_periods(author.get("initials") or first[:1].upper())
    if style in {"apa", "harvard"}:
        return f"{last}, {initials}".strip().rstrip(",")
    if invert:
        return f"{last}, {first}".strip().rstrip(",")
    return f"{first} {last}".strip()


def _join_author_names(values: list[str], *, final_joiner: str = ", and ") -> str:
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]}{final_joiner}{values[1]}"
    return f"{', '.join(values[:-1])}{final_joiner}{values[-1]}"


def _authors_for_style(authors: list[dict[str, Any]], style: str) -> str:
    if not authors:
        return ""
    if style == "apa":
        names = [
            _author_bib_name(author, style=style, invert=True)
            for author in authors
        ]
        return _join_author_names(names, final_joiner=", & ")
    if style == "harvard":
        if len(authors) > 3:
            return f"{_author_bib_name(authors[0], style=style, invert=True)} et al."
        names = [_author_bib_name(author, style=style, invert=True) for author in authors]
        return _join_author_names(names, final_joiner=" and ")
    if style == "mla":
        if len(authors) > 2:
            return f"{_author_bib_name(authors[0], style=style, invert=True)} et al."
        first = _author_bib_name(authors[0], style=style, invert=True)
        if len(authors) == 1:
            return first
        second = _author_bib_name(authors[1], style=style, invert=False)
        return f"{first}, and {second}"
    if len(authors) > 3:
        return f"{_author_bib_name(authors[0], style=style, invert=True)} et al."
    names = [
        _author_bib_name(author, style=style, invert=index == 0)
        for index, author in enumerate(authors)
    ]
    return _join_author_names(names, final_joiner=", and ")


def _inline_author_label(source: dict[str, Any], style: str) -> str:
    authors = source.get("authors") or []
    if not authors:
        title = _clean(source.get("title")) or "Source"
        return " ".join(title.split()[:3])
    if style in {"apa", "harvard"}:
        if len(authors) == 1:
            return authors[0].get("lastName") or authors[0].get("fullName") or "Source"
        if len(authors) == 2:
            first = authors[0].get("lastName") or authors[0].get("fullName") or "Source"
            second = authors[1].get("lastName") or authors[1].get("fullName") or "Source"
            joiner = " & " if style == "apa" else " and "
            return f"{first}{joiner}{second}"
        return f"{authors[0].get('lastName') or authors[0].get('fullName') or 'Source'} et al."
    if len(authors) == 1:
        return authors[0].get("lastName") or authors[0].get("fullName") or "Source"
    if len(authors) == 2:
        first = authors[0].get("lastName") or authors[0].get("fullName") or "Source"
        second = authors[1].get("lastName") or authors[1].get("fullName") or "Source"
        return f"{first} and {second}"
    return f"{authors[0].get('lastName') or authors[0].get('fullName') or 'Source'} et al."


def _issued_year(source: dict[str, Any]) -> str:
    issued = source.get("issued") or {}
    year = issued.get("year")
    if isinstance(year, int):
        return str(year)
    return _parse_year(issued.get("raw"))


def _format_date(source: dict[str, Any], *, style: str, long_form: bool = False) -> str:
    issued = source.get("issued") or {}
    year = issued.get("year")
    month = issued.get("month")
    day = issued.get("day")
    if not year:
        return "n.d."
    if not month:
        return str(year)
    month_name = MONTH_NAMES.get(int(month), str(month))
    if not day:
        return f"{year}, {month_name}" if style == "apa" else f"{month_name} {year}"
    if style == "apa":
        return f"{year}, {month_name} {day}"
    if long_form:
        return f"{day} {month_name} {year}"
    return str(year)


def _format_access_date(source: dict[str, Any]) -> str:
    access = ((source.get("metadata") or {}).get("accessed_date") or {})
    if not access:
        return ""
    year = access.get("year")
    month = access.get("month")
    day = access.get("day")
    if year and month and day:
        return f"{day} {MONTH_NAMES.get(int(month), str(month))} {year}"
    return _clean(access.get("raw"))


def _preferred_locator(context: dict[str, Any], *, style: str) -> str:
    locator = context.get("locator") or {}
    page = _clean(locator.get("page"))
    paragraph = _clean(locator.get("paragraph"))
    if style == "mla":
        if page:
            return page
        if paragraph:
            return f"par. {paragraph}"
        return ""
    if page:
        return f"p. {page}"
    if paragraph:
        return f"para. {paragraph}"
    return ""


def _page_range(source: dict[str, Any]) -> str:
    metadata = source.get("metadata") or {}
    pages = _clean(metadata.get("pages"))
    if pages:
        return pages
    first_page = _clean(metadata.get("first_page"))
    last_page = _clean(metadata.get("last_page"))
    if first_page and last_page:
        return f"{first_page}-{last_page}"
    return first_page or last_page


def _container_segment(source: dict[str, Any], *, style: str) -> str:
    container = _clean(source.get("container_title"))
    metadata = source.get("metadata") or {}
    volume = _clean(metadata.get("volume"))
    issue = _clean(metadata.get("issue"))
    pages = _page_range(source)
    parts: list[str] = []
    if container:
        parts.append(container)
    if volume:
        volume_part = f"vol. {volume}" if style in {"mla", "chicago", "harvard"} else volume
        if issue:
            volume_part = f"{volume_part}({issue})" if style == "apa" else f"{volume_part}, no. {issue}"
        parts.append(volume_part)
    elif issue:
        parts.append(f"no. {issue}")
    if pages:
        prefix = "pp. " if "-" in pages else "p. "
        parts.append(f"{prefix}{pages}")
    return ", ".join(part for part in parts if part)


def _link_for_source(source: dict[str, Any]) -> str:
    identifiers = source.get("identifiers") or {}
    doi = _normalize_doi(identifiers.get("doi"))
    source_type = _clean(source.get("source_type"))
    if doi and source_type in {"journal_article", "book", "dataset", "report"}:
        return f"https://doi.org/{doi}"
    return _clean(source.get("canonical_url") or source.get("page_url"))


def _title_text(source: dict[str, Any], *, style: str, quoted: bool) -> str:
    title = source.get("title_case") if style in {"mla", "chicago"} else source.get("sentence_case")
    title = _clean(title or source.get("title")) or "Untitled page"
    if quoted:
        return f"\"{title}.\""
    return title


def _source_kind(source: dict[str, Any]) -> str:
    normalized = _normalize_source_type(source.get("source_type") or "webpage")
    return normalized


def _is_container_work(source: dict[str, Any]) -> bool:
    return _source_kind(source) in {"journal_article", "article"}


def _render_apa_bibliography(source: dict[str, Any]) -> str:
    authors = _authors_for_style(source.get("authors") or [], "apa") or _clean(source.get("publisher") or source.get("site_name") or "Source")
    date_text = _format_date(source, style="apa")
    source_type = _source_kind(source)
    title = _title_text(source, style="apa", quoted=False)
    container = _container_segment(source, style="apa")
    publisher = _clean(source.get("publisher") or source.get("site_name"))
    link = _link_for_source(source)
    if source_type == "book":
        parts = [f"{authors}. ({date_text}). {title}.", publisher]
    elif source_type == "dataset":
        parts = [f"{authors}. ({date_text}). {title} [Data set].", publisher]
    elif source_type == "report":
        parts = [f"{authors}. ({date_text}). {title}.", publisher]
    elif _is_container_work(source):
        parts = [f"{authors}. ({date_text}). {title}.", container or publisher]
    else:
        parts = [f"{authors}. ({date_text}). {title}.", publisher]
    if link:
        parts.append(link)
    bibliography = " ".join(part.strip() for part in parts if part).strip()
    return bibliography if bibliography.endswith(".") else bibliography + "."


def _render_mla_bibliography(source: dict[str, Any]) -> str:
    authors = _authors_for_style(source.get("authors") or [], "mla") or _clean(source.get("publisher") or source.get("site_name") or "Source")
    title = _title_text(source, style="mla", quoted=_source_kind(source) != "book")
    container = _container_segment(source, style="mla")
    publisher = _clean(source.get("publisher") or source.get("site_name"))
    year = _issued_year(source)
    link = _link_for_source(source)
    access = _format_access_date(source)
    parts = [f"{authors}. {title}"]
    if _source_kind(source) == "book":
        parts = [f"{authors}. *{_title_text(source, style='mla', quoted=False)}*."]
    if container:
        parts.append(f"*{container}*")
    elif publisher and _source_kind(source) != "book":
        parts.append(publisher)
    if publisher and _source_kind(source) in {"report", "dataset", "webpage", "article"}:
        parts.append(publisher)
    if year != "n.d.":
        parts.append(year)
    if link:
        parts.append(link)
    bibliography = ", ".join(part.strip().rstrip(".") for part in parts if part).strip()
    bibliography = bibliography.rstrip(",") + "."
    if access and _source_kind(source) in {"webpage", "article", "report", "dataset"}:
        bibliography += f" Accessed {access}."
    return bibliography


def _render_chicago_bibliography(source: dict[str, Any]) -> str:
    authors = _authors_for_style(source.get("authors") or [], "chicago") or _clean(source.get("publisher") or source.get("site_name") or "Source")
    title = _title_text(source, style="chicago", quoted=_source_kind(source) != "book")
    container = _container_segment(source, style="chicago")
    publisher = _clean(source.get("publisher") or source.get("site_name"))
    date_text = _format_date(source, style="chicago", long_form=True)
    link = _link_for_source(source)
    if _source_kind(source) == "book":
        parts = [f"{authors}. *{_title_text(source, style='chicago', quoted=False)}*.", publisher, date_text]
    else:
        parts = [f"{authors}. {title}", container or publisher, date_text]
    if link:
        parts.append(link)
    return ". ".join(part.strip().rstrip(".") for part in parts if part) + "."


def _render_harvard_bibliography(source: dict[str, Any]) -> str:
    authors = _authors_for_style(source.get("authors") or [], "harvard") or _clean(source.get("publisher") or source.get("site_name") or "Source")
    year = _issued_year(source)
    title = _title_text(source, style="harvard", quoted=_source_kind(source) != "book")
    container = _container_segment(source, style="harvard")
    publisher = _clean(source.get("publisher") or source.get("site_name"))
    link = _link_for_source(source)
    access = _format_access_date(source)
    if _source_kind(source) == "book":
        parts = [f"{authors} ({year}) *{_title_text(source, style='harvard', quoted=False)}*.", publisher]
    else:
        parts = [f"{authors} ({year}) {title}.", container or publisher]
        if publisher and publisher not in parts[-1]:
            parts.append(publisher)
    if link:
        parts.append(f"Available at: {link}")
    bibliography = " ".join(part.strip() for part in parts if part).strip()
    if access and _source_kind(source) in {"webpage", "article", "report", "dataset"}:
        bibliography += f" (Accessed: {access})."
    elif not bibliography.endswith("."):
        bibliography += "."
    return bibliography


STYLE_BIBLIOGRAPHY_RENDERERS = {
    "apa": _render_apa_bibliography,
    "mla": _render_mla_bibliography,
    "chicago": _render_chicago_bibliography,
    "harvard": _render_harvard_bibliography,
}


def _render_inline(source: dict[str, Any], context: dict[str, Any], *, style: str) -> str:
    author_label = _inline_author_label(source, style)
    year = _issued_year(source)
    locator = _preferred_locator(context, style=style)
    if style == "mla":
        if locator:
            return f"({author_label}, {locator})"
        return f"({author_label})"
    if style == "chicago":
        inner = f"{author_label} {year}" if year != "n.d." else author_label
        if locator:
            inner += f", {locator}"
        return f"({inner})"
    inner = f"{author_label}, {year}" if year != "n.d." else author_label
    if locator:
        inner += f", {locator}"
    return f"({inner})"


def _render_footnote(source: dict[str, Any], context: dict[str, Any], *, style: str) -> str:
    bibliography = STYLE_BIBLIOGRAPHY_RENDERERS.get(style, _render_mla_bibliography)(source).rstrip(".")
    quote = _clean(context.get("quote") or context.get("excerpt"))
    locator = _preferred_locator(context, style=style)
    suffix = f", {locator}" if locator else ""
    if quote:
        return f"{bibliography}{suffix}, quote: \"{quote}\"."
    return f"{bibliography}{suffix}."


def render_citation(source: dict[str, Any], context: dict[str, Any], *, style: str, render_kind: str) -> str:
    normalized_style = (style or "mla").strip().lower()
    normalized_kind = (render_kind or "bibliography").strip().lower()
    if normalized_style not in SUPPORTED_STYLES:
        normalized_style = "mla"
    if normalized_kind not in SUPPORTED_RENDER_KINDS:
        normalized_kind = "bibliography"

    if normalized_kind == "inline":
        return _render_inline(source, context, style=normalized_style)

    if normalized_kind == "footnote":
        return _render_footnote(source, context, style=normalized_style)

    if normalized_kind == "quote_attribution":
        inline = render_citation(source, context, style=normalized_style, render_kind="inline")
        quote = context.get("quote") or context.get("excerpt")
        if quote:
            return f"\"{quote}\" {inline}"
        return inline

    return STYLE_BIBLIOGRAPHY_RENDERERS.get(normalized_style, _render_mla_bibliography)(source)


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
