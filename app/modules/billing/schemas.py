from typing import Literal

from pydantic import BaseModel


class BillingStatus(BaseModel):
    module: str = "billing"
    schema_contract: str
    status: str = "active"


class BillingCheckoutRequest(BaseModel):
    tier: Literal["standard", "pro"]
    interval: Literal["monthly", "yearly"]


class BillingCheckoutResponse(BaseModel):
    provider: Literal["paddle"] = "paddle"
    tier: Literal["standard", "pro"]
    interval: Literal["monthly", "yearly"]
    transaction_id: str
    checkout_url: str | None = None
