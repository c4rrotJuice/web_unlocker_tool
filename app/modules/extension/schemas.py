from pydantic import BaseModel


class ExtensionStatus(BaseModel):
    module: str = "extension"
    schema_contract: str
    status: str = "scaffolded"
