from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InsightsStatus(BaseModel):
    module: str = "insights"
    schema_contract: str
    status: str = "active"


class MonthlyQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str | None = None

    @field_validator("month")
    @classmethod
    def normalize_month(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ReportMetadata(BaseModel):
    month: str
    range: dict[str, str]
    status: str
    available: bool
    generated_at: str | None = None
    download_url: str | None = None
    supported_formats: list[str] = Field(default_factory=list)
    sections: dict[str, object] = Field(default_factory=dict)
    completeness: float
    missing_sections: list[str] = Field(default_factory=list)
    timezone: str
