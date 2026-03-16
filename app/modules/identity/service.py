from __future__ import annotations

from app.core.account_state import AccountStateService
from app.core.auth import RequestAuthContext
from app.core.config import get_settings
from app.core.entitlements import derive_capability_state
from app.core.serialization import (
    serialize_account_state,
    serialize_capability_state,
    serialize_module_status,
    serialize_request_auth_context,
)
from app.modules.identity.repo import IdentityRepository


class IdentityService:
    def __init__(self, *, repository: IdentityRepository):
        self.repository = repository
        self.account_state_service = AccountStateService(repository)

    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="identity",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Canonical account truth comes from user_profiles, user_preferences, user_entitlements, and billing tables.",
                "Bearer verification is strict and never trusts JS-readable auth cookies.",
            ],
        )

    async def me(self, auth_context: RequestAuthContext) -> dict[str, object]:
        return serialize_request_auth_context(auth_context)

    async def account(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.account_state_service.load(auth_context.user_id)
        return serialize_account_state(account_state)

    async def capabilities(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.account_state_service.load(auth_context.user_id)
        capability_state = derive_capability_state(
            user_id=auth_context.user_id,
            tier=account_state.entitlement.tier,
            status=account_state.entitlement.status,
            paid_until=account_state.entitlement.paid_until,
        )
        return serialize_capability_state(capability_state)
