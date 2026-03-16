from pydantic import BaseModel


class BillingStatus(BaseModel):
    module: str = "billing"
    schema_contract: str
    status: str = "active"
