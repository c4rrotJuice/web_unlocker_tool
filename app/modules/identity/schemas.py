from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


Theme = Literal["light", "dark", "system"]
EditorDensity = Literal["compact", "comfortable", "spacious"]
CitationStyle = Literal["apa", "mla", "chicago", "harvard", "custom"]


class IdentityStatus(BaseModel):
    module: str = "identity"
    schema_contract: str
    status: str = "active"


class SignupRequest(BaseModel):
    email: EmailStr | None = None
    password: str | None = None
    display_name: str | None = None
    use_case: str | None = None
    user_id: str | None = None

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("display_name must not be empty.")
        if len(normalized) > 120:
            raise ValueError("display_name must be 120 characters or fewer.")
        return normalized

    @field_validator("use_case")
    @classmethod
    def normalize_use_case(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("password")
    @classmethod
    def normalize_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("password must not be empty.")
        return normalized


class ProfilePatchRequest(BaseModel):
    display_name: str | None = Field(default=None)
    use_case: str | None = Field(default=None)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("display_name must not be empty.")
        if len(normalized) > 120:
            raise ValueError("display_name must be 120 characters or fewer.")
        return normalized

    @field_validator("use_case")
    @classmethod
    def validate_use_case(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class PreferencesPatchRequest(BaseModel):
    theme: Theme | None = None
    editor_density: EditorDensity | None = None
    default_citation_style: CitationStyle | None = None
    sidebar_collapsed: bool | None = None
    sidebar_auto_hide: bool | None = None
