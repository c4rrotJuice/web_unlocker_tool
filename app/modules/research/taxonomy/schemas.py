from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ProjectCreateRequest(BaseModel):
    name: str
    color: str | None = None
    description: str | None = None
    icon: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("name is required")
        if len(normalized) > 120:
            raise ValueError("name must be 120 characters or fewer")
        return normalized


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    color: str | None = None
    description: str | None = None
    icon: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("name must not be empty")
        if len(normalized) > 120:
            raise ValueError("name must be 120 characters or fewer")
        return normalized


class TagCreateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("name is required")
        if len(normalized) > 80:
            raise ValueError("name must be 80 characters or fewer")
        return normalized


class TagUpdateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise ValueError("name is required")
        if len(normalized) > 80:
            raise ValueError("name must be 80 characters or fewer")
        return normalized


class TagResolveRequest(BaseModel):
    tag_ids: list[str] = Field(default_factory=list)
    names: list[str] = Field(default_factory=list)
