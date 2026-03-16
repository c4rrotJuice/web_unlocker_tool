from pydantic import BaseModel


class WorkspaceStatus(BaseModel):
    module: str = "workspace"
    schema_contract: str
    status: str = "scaffolded"
