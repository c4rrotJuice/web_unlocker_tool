from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class BillingService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="billing",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Billing sync will mutate user_entitlements instead of user_meta.",
                "Provider state belongs in billing_customers and billing_subscriptions only.",
            ],
        )
