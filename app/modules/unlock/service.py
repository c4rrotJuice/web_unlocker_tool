from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class UnlockService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="unlock",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Unlock accounting will persist to unlock_events and guest_unlock_usage.",
                "Bookmark and milestone reads belong here, not in dashboard routes.",
            ],
        )
