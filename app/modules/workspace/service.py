from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class WorkspaceService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="workspace",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Document relation writes will be routed through canonical atomic RPCs only.",
                "documents.citation_ids and other compatibility serializers stay removed.",
            ],
        )
