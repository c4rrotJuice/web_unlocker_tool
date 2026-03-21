from __future__ import annotations

import logging

from fastapi import HTTPException
from supabase import create_client
from supabase.client import AuthApiError

from app.core.account_state import AccountState, UserEntitlement, UserPreferences, UserProfile
from app.core.auth import RequestAuthContext
from app.core.config import get_settings
from app.core.entitlements import derive_capability_state
from app.core.errors import AccountBootstrapFailedError
from app.core.serialization import (
    serialize_account_bootstrap,
    serialize_entitlement,
    serialize_module_status,
    serialize_ok_envelope,
    serialize_preferences,
    serialize_profile,
)
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.schemas import PreferencesPatchRequest, ProfilePatchRequest, SignupRequest


logger = logging.getLogger(__name__)


class IdentityService:
    def __init__(self, *, repository: IdentityRepository, supabase_admin=None):
        self.repository = repository
        settings = get_settings()
        self.supabase_admin = supabase_admin or create_client(settings.supabase_url or "", settings.supabase_service_role_key or "")

    def _create_supabase_user(self, *, email: str | None, password: str | None):
        if not email or not password:
            raise HTTPException(status_code=422, detail="email and password are required when user_id is not provided.")
        admin_api = getattr(getattr(self.supabase_admin, "auth", None), "admin", None)
        if admin_api is not None and hasattr(admin_api, "create_user"):
            created = admin_api.create_user({"email": email, "password": password, "email_confirm": False})
            user = getattr(created, "user", None)
            return user or created
        created = self.supabase_admin.auth.sign_up({"email": email, "password": password})
        return getattr(created, "user", None)

    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="identity",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Canonical account truth comes from user_profiles, user_preferences, and user_entitlements.",
                "Authenticated account reads use verified bearer auth against canonical tables.",
            ],
        )

    async def signup(self, payload: SignupRequest) -> dict[str, object]:
        user_id = payload.user_id
        if not user_id:
            try:
                user = self._create_supabase_user(email=payload.email, password=payload.password)
            except AuthApiError as exc:
                raise HTTPException(status_code=400, detail=exc.message) from exc
            user_id = getattr(user, "id", None)
        if not user_id:
            raise AccountBootstrapFailedError("Signup succeeded but no canonical user id was returned.")

        await self._invoke_bootstrap(
            user_id=str(user_id),
            display_name=payload.display_name,
            use_case=payload.use_case,
            recovery=False,
        )
        return serialize_ok_envelope(
            {
                "user_id": str(user_id),
                "bootstrap_completed": True,
            }
        )

    async def me(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        capability_state = self._capability_state(account_state)
        return serialize_ok_envelope(serialize_account_bootstrap(account_state, capability_state))

    async def profile(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        return serialize_ok_envelope(serialize_profile(account_state.profile))

    async def update_profile(self, auth_context: RequestAuthContext, payload: ProfilePatchRequest) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        patch = payload.model_dump(exclude_none=True)
        if patch:
            updated = await self.repository.update_profile(
                auth_context.user_id,
                auth_context.access_token or "",
                patch,
            )
            if updated is None:
                raise AccountBootstrapFailedError("Canonical profile update did not affect the authenticated user.")
            account_state = await self.ensure_account_bootstrapped(
                auth_context,
                display_name=patch.get("display_name") if isinstance(patch.get("display_name"), str) else account_state.profile.display_name,
                use_case=patch.get("use_case") if "use_case" in patch else account_state.profile.use_case,
            )
        return serialize_ok_envelope(serialize_profile(account_state.profile))

    async def preferences(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        return serialize_ok_envelope(serialize_preferences(account_state.preferences))

    async def update_preferences(self, auth_context: RequestAuthContext, payload: PreferencesPatchRequest) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        patch = payload.model_dump(exclude_none=True)
        if patch:
            updated = await self.repository.update_preferences(
                auth_context.user_id,
                auth_context.access_token or "",
                patch,
            )
            if updated is None:
                raise AccountBootstrapFailedError("Canonical preferences update did not affect the authenticated user.")
            account_state = await self.ensure_account_bootstrapped(auth_context)
        return serialize_ok_envelope(serialize_preferences(account_state.preferences))

    async def current_entitlement(self, auth_context: RequestAuthContext) -> dict[str, object]:
        account_state = await self.ensure_account_bootstrapped(auth_context)
        capability_state = self._capability_state(account_state)
        return serialize_ok_envelope(
            {
                "entitlement": serialize_entitlement(account_state.entitlement),
                "capabilities": serialize_account_bootstrap(account_state, capability_state)["capabilities"],
            }
        )

    async def ensure_account_bootstrapped(
        self,
        auth_context: RequestAuthContext,
        *,
        display_name: str | None = None,
        use_case: str | None = None,
    ) -> AccountState:
        account_state = await self._load_account_state(auth_context)
        if account_state is not None:
            return account_state

        logger.info("account.bootstrap.recovery_triggered", extra={"user_id": auth_context.user_id})
        await self._invoke_bootstrap(
            user_id=auth_context.user_id,
            display_name=display_name,
            use_case=use_case,
            recovery=True,
        )

        recovered = await self._load_account_state(auth_context)
        if recovered is None:
            logger.error("account.bootstrap.failed", extra={"user_id": auth_context.user_id})
            raise AccountBootstrapFailedError()

        logger.info("account.bootstrap.recovered", extra={"user_id": auth_context.user_id})
        return recovered

    async def _invoke_bootstrap(
        self,
        *,
        user_id: str,
        display_name: str | None,
        use_case: str | None,
        recovery: bool,
    ) -> None:
        logger.info(
            "account.bootstrap.invoked",
            extra={"user_id": user_id, "recovery": recovery},
        )
        success = await self.repository.bootstrap_user(
            user_id,
            display_name=display_name or "User",
            use_case=use_case,
        )
        if not success:
            logger.error("account.bootstrap.failed", extra={"user_id": user_id})
            raise AccountBootstrapFailedError()

    async def _load_account_state(self, auth_context: RequestAuthContext) -> AccountState | None:
        access_token = auth_context.access_token or ""
        profile_row = await self.repository.fetch_profile(auth_context.user_id, access_token)
        preferences_row = await self.repository.fetch_preferences(auth_context.user_id, access_token)
        entitlement_row = await self.repository.fetch_entitlement(auth_context.user_id, access_token)
        if not profile_row or not preferences_row or not entitlement_row:
            return None
        return AccountState(
            profile=UserProfile(
                user_id=auth_context.user_id,
                display_name=str(profile_row.get("display_name") or "User"),
                use_case=profile_row.get("use_case") if isinstance(profile_row.get("use_case"), str) else None,
                created_at=profile_row.get("created_at") if isinstance(profile_row.get("created_at"), str) else None,
                updated_at=profile_row.get("updated_at") if isinstance(profile_row.get("updated_at"), str) else None,
            ),
            preferences=UserPreferences(
                theme=str(preferences_row.get("theme") or "system"),
                editor_density=str(preferences_row.get("editor_density") or "comfortable"),
                default_citation_style=str(preferences_row.get("default_citation_style") or "apa"),
                sidebar_collapsed=bool(preferences_row.get("sidebar_collapsed") or False),
                sidebar_auto_hide=bool(preferences_row.get("sidebar_auto_hide") or False),
                defaults_applied=False,
                created_at=preferences_row.get("created_at") if isinstance(preferences_row.get("created_at"), str) else None,
                updated_at=preferences_row.get("updated_at") if isinstance(preferences_row.get("updated_at"), str) else None,
            ),
            entitlement=UserEntitlement(
                tier=str(entitlement_row.get("tier") or "free"),
                status=str(entitlement_row.get("status") or "active"),
                paid_until=entitlement_row.get("paid_until") if isinstance(entitlement_row.get("paid_until"), str) else None,
                auto_renew=bool(entitlement_row.get("auto_renew") or False),
                source=str(entitlement_row.get("source") or "system"),
                created_at=entitlement_row.get("created_at") if isinstance(entitlement_row.get("created_at"), str) else None,
                updated_at=entitlement_row.get("updated_at") if isinstance(entitlement_row.get("updated_at"), str) else None,
            ),
            billing_customer=None,
            billing_subscription=None,
        )

    def _capability_state(self, account_state: AccountState):
        return derive_capability_state(
            user_id=account_state.profile.user_id,
            tier=account_state.entitlement.tier,
            status=account_state.entitlement.status,
            paid_until=account_state.entitlement.paid_until,
        )
