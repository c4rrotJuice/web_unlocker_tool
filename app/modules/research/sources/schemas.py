from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.services.citation_domain import ExtractionPayload


class SourceResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extraction_payload: ExtractionPayload


class SourceListQuery(BaseModel):
    query: str | None = None
    hostname: str | None = None
    source_type: str | None = None
    limit: int = 50
