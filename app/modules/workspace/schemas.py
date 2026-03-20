from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DocumentCreateRequest(BaseModel):
    title: str | None = None
    project_id: str | None = None
    seed: dict[str, Any] | None = None


class DocumentUpdateRequest(BaseModel):
    revision: str = Field(..., description="Expected document revision from the caller's last read")
    title: str | None = None
    content_delta: dict[str, Any] | None = None
    content_html: str | None = None
    project_id: str | None = None
    status: str | None = None


class CitationIdsReplaceRequest(BaseModel):
    revision: str = Field(..., description="Expected document revision from the caller's last read")
    citation_ids: list[str] = Field(default_factory=list)


class NoteIdsReplaceRequest(BaseModel):
    revision: str = Field(..., description="Expected document revision from the caller's last read")
    note_ids: list[str] = Field(default_factory=list)


class TagIdsReplaceRequest(BaseModel):
    revision: str = Field(..., description="Expected document revision from the caller's last read")
    tag_ids: list[str] = Field(default_factory=list)


class CheckpointCreateRequest(BaseModel):
    label: str | None = None


class RestoreCheckpointRequest(BaseModel):
    checkpoint_id: str
