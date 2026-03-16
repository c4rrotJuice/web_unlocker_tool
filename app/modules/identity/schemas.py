from pydantic import BaseModel


class IdentityStatus(BaseModel):
    module: str = "identity"
    schema_contract: str
    status: str = "active"
