from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class InsightsService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="insights",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Dashboard and reporting will derive from canonical unlock, citation, note, and document data.",
                "No user_meta counters or legacy citations aggregates will survive the rebuild.",
            ],
        )
