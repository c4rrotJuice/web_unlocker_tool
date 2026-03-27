from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.research.notes.schemas import NoteSourceInput
from app.services.citation_domain import ExtractionPayload, SUPPORTED_STYLES


class ExtensionStatus(BaseModel):
    module: str = "extension"
    schema_contract: str
    status: str = "active"


class HandoffIssueRequest(BaseModel):
    redirect_path: str | None = None
    refresh_token: str
    expires_in: int | None = None
    token_type: str | None = None

    @field_validator("refresh_token")
    @classmethod
    def validate_refresh_token(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("refresh_token is required")
        return normalized


class HandoffExchangeRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("code is required")
        return normalized


class AuthAttemptCreateRequest(BaseModel):
    redirect_path: str | None = None


class AuthAttemptCompleteRequest(BaseModel):
    refresh_token: str
    expires_in: int | None = None
    token_type: str | None = None
    redirect_path: str | None = None

    @field_validator("refresh_token")
    @classmethod
    def validate_refresh_token(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("refresh_token is required")
        return normalized


class ExtensionCitationCaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str | None = None
    extraction_payload: ExtractionPayload
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


class ExtensionQuoteCaptureRequest(BaseModel):
    citation_id: str
    excerpt: str
    locator: dict[str, Any] = Field(default_factory=dict)
    annotation: str | None = None

    @field_validator("citation_id", "excerpt")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized


class ExtensionNoteCaptureRequest(BaseModel):
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


class WorkInEditorNoteSeed(BaseModel):
    title: str | None = None
    note_body: str
    project_id: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    sources: list[NoteSourceInput] = Field(default_factory=list)

    @field_validator("note_body")
    @classmethod
    def validate_note_body(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("note_body is required")
        return normalized


class WorkInEditorRequest(BaseModel):
    url: str
    title: str | None = None
    selected_text: str | None = None
    citation_format: str | None = None
    citation_text: str | None = None
    extraction_payload: ExtractionPayload | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    locator: dict[str, Any] = Field(default_factory=dict)
    project_id: str | None = None
    document_title: str | None = None
    note: WorkInEditorNoteSeed | None = None
    idempotency_key: str | None = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("url is required")
        return normalized

    @field_validator("idempotency_key")
    @classmethod
    def normalize_idempotency_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ExtensionUsageEventRequest(BaseModel):
    url: str
    event_id: str
    event_type: Literal["unlock", "selection_capture", "copy_assist"]
    was_cleaned: bool = True

    @field_validator("url", "event_id")
    @classmethod
    def validate_required(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized
