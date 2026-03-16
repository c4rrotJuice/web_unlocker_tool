from pydantic import BaseModel


class ResearchStatus(BaseModel):
    module: str = "research"
    schema_contract: str
    status: str = "scaffolded"
