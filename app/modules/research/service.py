from app.core.config import get_settings
from app.core.serialization import serialize_module_status


class ResearchService:
    def status(self) -> dict[str, object]:
        settings = get_settings()
        return serialize_module_status(
            module="research",
            contract=str(settings.migration_pack_dir),
            notes=[
                "Canonical relations will use note_sources, note_links, note_tag_links, and citation_* tables only.",
                "No compatibility fallback to legacy citations tables or schema probes will be kept.",
            ],
        )
