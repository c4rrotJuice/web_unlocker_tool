from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.citation_domain import SUPPORTED_STYLES


class CitationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extraction_payload: dict[str, Any]
    excerpt: str | None = None
    locator: dict[str, Any] = Field(default_factory=dict)
    annotation: str | None = None
    quote: str | None = None
    style: str | None = None

    @field_validator("style")
    @classmethod
    def validate_style(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_STYLES:
            raise ValueError("unsupported citation style")
        return normalized


class CitationUpdateRequest(BaseModel):
    locator: dict[str, Any] | None = None
    annotation: str | None = None
    excerpt: str | None = None
    quote: str | None = None


class CitationRenderRequest(BaseModel):
    citation_id: str
    style: str | None = None

    @field_validator("style")
    @classmethod
    def validate_style(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_STYLES:
            raise ValueError("unsupported citation style")
        return normalized


class CitationByIdsRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


class CitationTemplateCreateRequest(BaseModel):
    name: str
    template_body: str
    is_default: bool = False


class CitationTemplateUpdateRequest(BaseModel):
    name: str | None = None
    template_body: str | None = None
    is_default: bool | None = None
