from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any
from urllib.parse import urlparse
import re

SUPPORTED_STYLES = {"mla", "apa", "chicago", "harvard"}
METADATA_SCHEMA_VERSION = 2

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


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower().replace("www.", "")
    except Exception:  # noqa: BLE001
        return ""
    return host


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


def _parse_year(value: str) -> str:
    text = _clean(value)
    if not text:
        return "n.d."
    match = re.search(r"(19|20)\d{2}", text)
    return match.group(0) if match else "n.d."


def _parse_author_object(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        full = _clean(raw.get("fullName") or raw.get("name") or raw.get("author"))
    else:
        full = _clean(raw)

    if not full:
        return None

    normalized = INSTITUTION_EQUIVALENTS.get(full.lower(), full)
    parts = normalized.split()
    is_org = len(parts) == 1 or any(w.lower() in {"organization", "agency", "association", "department", "institute"} for w in parts)

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
    initials = "".join(p[:1].upper() for p in parts[:-1])
    return {
        "fullName": normalized,
        "firstName": first,
        "lastName": last,
        "initials": initials,
        "isOrganization": False,
    }


def _normalize_org_name(value: str) -> str:
    cleaned = _clean(value)
    if not cleaned:
        return ""
    return PUBLISHER_EQUIVALENTS.get(cleaned.lower(), cleaned)


def _canonical_url(url: str) -> str:
    cleaned = _clean(url)
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if not parsed.scheme or not parsed.netloc:
        return cleaned
    fragmentless = parsed._replace(fragment="")
    return fragmentless.geturl().rstrip("/")


def build_source_fingerprint(metadata: dict[str, Any]) -> str:
    doi = _clean(metadata.get("doi") or metadata.get("DOI"))
    if doi:
        return f"doi:{doi.lower().replace('https://doi.org/', '').replace('http://doi.org/', '')}"

    canonical_url = _canonical_url(metadata.get("url") or "")
    if canonical_url:
        return f"url:{canonical_url.lower()}"

    title = _clean(metadata.get("title") or "").lower()
    author = _clean(metadata.get("author") or "").lower()
    year = _parse_year(_clean(metadata.get("datePublished") or ""))
    digest = hashlib.sha1(f"{title}|{author}|{year}".encode("utf-8")).hexdigest()  # noqa: S324
    return f"meta:{digest}"


def compute_source_version(metadata: dict[str, Any]) -> str:
    canonical = {
        "title": _clean(metadata.get("title")),
        "authors": [
            _clean((item or {}).get("fullName"))
            for item in (metadata.get("authors") or [])
            if _clean((item or {}).get("fullName"))
        ],
        "publisher": _normalize_org_name(_clean(metadata.get("publisher") or metadata.get("siteName"))),
        "siteName": _normalize_org_name(_clean(metadata.get("siteName"))),
        "datePublished": _clean(metadata.get("datePublished")),
        "url": _canonical_url(_clean(metadata.get("url"))),
        "doi": _clean(metadata.get("doi") or metadata.get("DOI")).lower(),
    }
    payload = "|".join(
        [
            canonical["title"],
            ",".join(canonical["authors"]),
            canonical["publisher"],
            canonical["siteName"],
            canonical["datePublished"],
            canonical["url"],
            canonical["doi"],
        ],
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()  # noqa: S324


def normalize_metadata(metadata: dict[str, Any] | None, *, url: str = "", excerpt: str = "") -> dict[str, Any]:
    meta = dict(metadata or {})
    title = _clean(meta.get("title") or meta.get("headline")) or "Untitled Page"
    site_name = _normalize_org_name(_clean(meta.get("siteName") or meta.get("site_name") or meta.get("publisher")) or _domain(url))

    raw_authors = meta.get("authors") if isinstance(meta.get("authors"), list) else []
    if not raw_authors:
        raw_authors = [meta.get("author") or meta.get("creator") or meta.get("publisher") or site_name]

    authors = []
    seen = set()
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

    lead = authors[0] if authors else _parse_author_object(site_name)

    paragraph = meta.get("paragraph") or meta.get("paragraph_number")
    paragraph = int(paragraph) if str(paragraph).isdigit() else None

    normalized = {
        **meta,
        "url": _canonical_url(_clean(meta.get("url") or url)),
        "title": title,
        "title_case": _title_case(title),
        "sentence_case": _sentence_case(title),
        "siteName": site_name,
        "publisher": _normalize_org_name(_clean(meta.get("publisher") or site_name)),
        "authors": authors,
        "author": lead["fullName"] if lead else site_name,
        "datePublished": _clean(meta.get("datePublished") or meta.get("date_published") or meta.get("date") or meta.get("year")),
        "dateAccessed": _clean(meta.get("dateAccessed") or meta.get("accessed_at")) or datetime.now(timezone.utc).isoformat(),
        "paragraph": paragraph,
        "excerpt": _clean(meta.get("excerpt") or excerpt),
    }
    normalized["source_fingerprint"] = build_source_fingerprint(normalized)
    normalized["source_version"] = compute_source_version(normalized)
    normalized["metadata_schema_version"] = METADATA_SCHEMA_VERSION
    normalized["source"] = {
        "fingerprint": normalized["source_fingerprint"],
        "version": normalized["source_version"],
        "metadata": {
            "title": normalized["title"],
            "authors": normalized["authors"],
            "publisher": normalized["publisher"],
            "siteName": normalized["siteName"],
            "datePublished": normalized["datePublished"],
            "dateAccessed": normalized["dateAccessed"],
            "url": normalized["url"],
            "doi": _clean(meta.get("doi") or meta.get("DOI")),
        },
    }
    normalized["quote"] = {
        "selected_text": normalized["excerpt"],
        "short_excerpt": normalized["excerpt"][:280],
        "locator": {"paragraph": paragraph} if paragraph else {},
    }
    return normalized


def _authors_for_style(authors: list[dict[str, Any]], style: str) -> str:
    if not authors:
        return ""
    mapped = []
    for author in authors:
        if author.get("isOrganization"):
            mapped.append(author["fullName"])
        elif style in {"apa", "harvard"}:
            initials = " ".join(f"{ch}." for ch in (author.get("initials") or ""))
            mapped.append(f"{author.get('lastName')}, {initials}".strip().rstrip(","))
        else:
            mapped.append(f"{author.get('lastName')}, {author.get('firstName')}".strip().rstrip(","))
    if len(mapped) == 1:
        return mapped[0]
    if style in {"apa", "harvard"}:
        return f"{mapped[0]} et al."
    return f"{mapped[0]}, et al."


def generate_citation_outputs(style: str, metadata: dict[str, Any]) -> dict[str, str]:
    normalized_style = (style or "mla").strip().lower()
    if normalized_style not in SUPPORTED_STYLES:
        normalized_style = "mla"

    meta = normalize_metadata(metadata, url=metadata.get("url", ""), excerpt=metadata.get("excerpt", ""))
    year = _parse_year(meta.get("datePublished", ""))
    author_obj = meta["authors"][0] if meta.get("authors") else _parse_author_object(meta.get("author"))
    author_last = author_obj.get("lastName") if author_obj else meta.get("siteName")
    paragraph = meta.get("paragraph")

    if normalized_style == "mla":
        inline = f"({author_last}{f', par. {paragraph}' if paragraph else ''})"
        full = f"{_authors_for_style(meta['authors'], 'mla') or meta['author']}. \"{meta['title_case']}.\" *{meta['siteName']}*, {year}, {meta['url']}."
    elif normalized_style == "chicago":
        inline = f"({author_last}{f', para. {paragraph}' if paragraph else ''})"
        full = f"{_authors_for_style(meta['authors'], 'chicago') or meta['author']}. \"{meta['title_case']}.\" {meta['siteName']}. {meta['url']}."
    elif normalized_style == "harvard":
        inline = f"({author_last}, {year}{f', para. {paragraph}' if paragraph else ''})"
        full = f"{_authors_for_style(meta['authors'], 'harvard') or meta['author']} ({year}) {meta['sentence_case']}. {meta['siteName']}. Available at: {meta['url']}."
    else:  # apa
        inline = f"({author_last}, {year}{f', para. {paragraph}' if paragraph else ''})"
        full = f"{_authors_for_style(meta['authors'], 'apa') or meta['author']}. ({year}). {meta['sentence_case']}. {meta['siteName']}. {meta['url']}"

    return {"inline_citation": inline, "full_citation": full}


def generate_render_bundle(metadata: dict[str, Any], styles: list[str] | None = None) -> dict[str, Any]:
    selected_styles = styles or sorted(SUPPORTED_STYLES)
    normalized = normalize_metadata(metadata, url=metadata.get("url", ""), excerpt=metadata.get("excerpt", ""))
    renders: dict[str, dict[str, str]] = {}
    for style in selected_styles:
        if style not in SUPPORTED_STYLES:
            continue
        renders[style] = generate_citation_outputs(style, normalized)
    return {
        "source_fingerprint": normalized["source_fingerprint"],
        "source_version": normalized["source_version"],
        "metadata": normalized,
        "renders": renders,
    }
