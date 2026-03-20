from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class NoteSourceInput(BaseModel):
    id: str | None = None
    source_id: str | None = None
    citation_id: str | None = None
    relation_type: str | None = None
    url: str | None = None
    hostname: str | None = None
    title: str | None = None
    source_author: str | None = None
    source_published_at: str | None = None
    position: int | None = None

    @field_validator("position")
    @classmethod
    def validate_position(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value < 0:
            raise ValueError("position must be non-negative")
        return value


class NoteCreateRequest(BaseModel):
    title: str
    note_body: str
    highlight_text: str | None = None
    project_id: str | None = None
    citation_id: str | None = None
    quote_id: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    sources: list[NoteSourceInput] = Field(default_factory=list)
    linked_note_ids: list[str] = Field(default_factory=list)

    @field_validator("title", "note_body")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized


class NoteUpdateRequest(BaseModel):
    title: str | None = None
    note_body: str | None = None
    highlight_text: str | None = None
    status: str | None = None
    project_id: str | None = None
    citation_id: str | None = None
    quote_id: str | None = None


class TagIdsReplaceRequest(BaseModel):
    tag_ids: list[str] = Field(default_factory=list)


class NoteSourcesReplaceRequest(BaseModel):
    sources: list[NoteSourceInput] = Field(default_factory=list)


class NoteLinksReplaceRequest(BaseModel):
    linked_note_ids: list[str] = Field(default_factory=list)
