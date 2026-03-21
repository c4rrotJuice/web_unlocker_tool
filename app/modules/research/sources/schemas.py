from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class SourceResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extraction_payload: dict[str, Any]


class SourceListQuery(BaseModel):
    query: str | None = None
    hostname: str | None = None
    source_type: str | None = None
    limit: int = 50
