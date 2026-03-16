from pydantic import BaseModel


class InsightsStatus(BaseModel):
    module: str = "insights"
    schema_contract: str
    status: str = "scaffolded"
