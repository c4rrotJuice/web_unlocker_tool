from pydantic import BaseModel


class UnlockStatus(BaseModel):
    module: str = "unlock"
    schema_contract: str
    status: str = "scaffolded"
