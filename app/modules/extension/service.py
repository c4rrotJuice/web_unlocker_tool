from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class ExtensionService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="extension",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Extension routes remain orchestration-only and will not own business logic.",
                "Auth handoff, note sync, and unlock permit flows will be rebuilt on shared canonical services.",
            ],
        )
