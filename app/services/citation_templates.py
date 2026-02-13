from __future__ import annotations

import re
from typing import Any

ALLOWED_TOKENS = {
    "citation_text",
    "author",
    "co_authors",
    "title",
    "publication_title",
    "publisher",
    "volume",
    "issue",
    "pages",
    "year",
    "month",
    "day",
    "date_accessed",
    "url",
    "doi",
    "edition",
    "location",
}

TOKEN_PATTERN = re.compile(r"\{([a-z_]+)\}")


def extract_tokens(template: str) -> set[str]:
    return set(TOKEN_PATTERN.findall(template or ""))


def validate_template(template: str) -> tuple[bool, str | None]:
    if not template or not template.strip():
        return False, "Template must not be empty."
    if len(template) > 2000:
        return False, "Template is too long."

    found = extract_tokens(template)
    unknown = sorted(found - ALLOWED_TOKENS)
    if unknown:
        return False, f"Unsupported tokens: {', '.join(unknown)}"

    if "{" in template or "}" in template:
        cleaned = TOKEN_PATTERN.sub("", template)
        if "{" in cleaned or "}" in cleaned:
            return False, "Malformed token braces."

    return True, None


def render_template(template: str, values: dict[str, Any]) -> str:
    safe_values = {key: str(values.get(key, "") or "") for key in ALLOWED_TOKENS}

    def _replace(match: re.Match[str]) -> str:
        token = match.group(1)
        return safe_values.get(token, "")

    return TOKEN_PATTERN.sub(_replace, template)
