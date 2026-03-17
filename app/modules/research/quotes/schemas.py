from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class QuoteCreateRequest(BaseModel):
    citation_id: str
    excerpt: str
    locator: dict[str, Any] | None = Field(default_factory=dict)
    annotation: str | None = None

    @field_validator("excerpt")
    @classmethod
    def validate_excerpt(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("excerpt is required")
        return normalized


class QuoteUpdateRequest(BaseModel):
    excerpt: str | None = None
    locator: dict[str, Any] | None = None
    annotation: str | None = None

    @field_validator("excerpt")
    @classmethod
    def validate_excerpt(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("excerpt must not be empty")
        return normalized


class QuoteToNoteRequest(BaseModel):
    title: str
    note_body: str
    project_id: str | None = None
    tag_ids: list[str] = Field(default_factory=list)

    @field_validator("title", "note_body")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized
