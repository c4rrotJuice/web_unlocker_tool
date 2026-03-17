from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SourceResolveRequest(BaseModel):
    extraction_payload: dict[str, Any] | None = None
    url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    excerpt: str | None = None
    quote: str | None = None
    locator: dict[str, Any] = Field(default_factory=dict)


class SourceListQuery(BaseModel):
    query: str | None = None
    hostname: str | None = None
    source_type: str | None = None
    limit: int = 50
