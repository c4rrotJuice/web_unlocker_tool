from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ActivityEventType = Literal["unlock", "selection_capture", "copy_assist"]
ActivitySource = Literal["web", "extension"]
SortDirection = Literal["asc", "desc"]
ActivitySortField = Literal["created_at"]
BookmarkSortField = Literal["created_at"]


class ActivityStatus(BaseModel):
    module: str = "unlock"
    schema_contract: str
    status: str = "active"


class ActivityEventCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: ActivityEventType
    url: str | None = None
    domain: str | None = None
    event_id: str | None = None
    source: ActivitySource = "web"
    was_cleaned: bool = True

    @field_validator("url", "domain", "event_id")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class BookmarkCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    domain: str | None = None
    title: str | None = None
    saved_from: ActivitySource | None = "web"

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("url is required")
        return normalized

    @field_validator("domain", "title")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ActivityHistoryQuery(BaseModel):
    event_type: ActivityEventType | None = None
    domain: str | None = None
    limit: int = Field(default=25, ge=1, le=100)
    cursor: str | None = None
    sort: ActivitySortField = "created_at"
    direction: SortDirection = "desc"

    @field_validator("domain", "cursor")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class BookmarkListQuery(BaseModel):
    limit: int = Field(default=25, ge=1, le=100)
    cursor: str | None = None
    sort: BookmarkSortField = "created_at"
    direction: SortDirection = "desc"

    @field_validator("cursor")
    @classmethod
    def normalize_cursor(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
