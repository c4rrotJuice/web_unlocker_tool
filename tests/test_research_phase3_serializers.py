from app.core.serialization import (
    serialize_citation,
    serialize_citation_template,
    serialize_project,
    serialize_source_detail,
    serialize_source_summary,
    serialize_tag,
)


def test_project_serializer_shape_is_stable():
    payload = serialize_project(
        {
            "id": "project-1",
            "name": "Project",
            "color": "#000",
            "description": "Desc",
            "icon": "book",
            "status": "archived",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        }
    )
    assert set(payload.keys()) == {"id", "name", "color", "description", "icon", "archived", "created_at", "updated_at"}
    assert payload["archived"] is True


def test_tag_serializer_shape_is_stable():
    payload = serialize_tag({"id": "tag-1", "name": "Evidence"})
    assert set(payload.keys()) == {"id", "name", "normalized_name"}
    assert payload["normalized_name"] == "evidence"


def test_source_summary_and_detail_serializer_shapes_are_stable():
    row = {
        "id": "source-1",
        "fingerprint": "url:https://example.com",
        "title": "Source",
        "source_type": "webpage",
        "authors": [{"fullName": "Ada Lovelace"}],
        "container_title": "Example",
        "publisher": "Example",
        "issued_date": {"raw": "2024-01-01", "year": 2024},
        "identifiers": {"doi": "10.1000/test"},
        "canonical_url": "https://example.com",
        "page_url": "https://example.com",
        "hostname": "example.com",
        "language_code": "en",
        "metadata": {"title_case": "Source"},
        "normalization_version": 1,
        "source_version": "sv1",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-02T00:00:00+00:00",
    }
    summary = serialize_source_summary(row, relationship_counts={"citation_count": 2})
    detail = serialize_source_detail(row, relationship_counts={"citation_count": 2})
    assert set(summary.keys()) == {
        "id",
        "title",
        "source_type",
        "authors",
        "container_title",
        "publisher",
        "issued_date",
        "identifiers",
        "canonical_url",
        "page_url",
        "hostname",
        "language_code",
        "created_at",
        "updated_at",
        "relationship_counts",
    }
    assert set(detail.keys()) == set(summary.keys()) | {"fingerprint", "metadata", "normalization_version", "source_version"}


def test_citation_serializer_shape_is_stable():
    payload = serialize_citation(
        {
            "id": "citation-1",
            "source_id": "source-1",
            "locator": {"page": "1"},
            "annotation": "note",
            "excerpt": "excerpt",
            "quote_text": "quote",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        },
        source=serialize_source_summary(
            {
                "id": "source-1",
                "title": "Source",
                "source_type": "webpage",
                "authors": [],
                "container_title": None,
                "publisher": None,
                "issued_date": {},
                "identifiers": {},
                "canonical_url": "https://example.com",
                "page_url": "https://example.com",
                "hostname": "example.com",
                "language_code": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            },
            relationship_counts={},
        ),
        renders={"mla": {"inline": "(Ada)", "bibliography": "Ada. Source."}},
        relationship_counts={"quote_count": 1, "note_count": 2, "document_count": 3},
    )
    assert set(payload.keys()) == {
        "id",
        "source_id",
        "source",
        "locator",
        "annotation",
        "excerpt",
        "quote_text",
        "renders",
        "created_at",
        "updated_at",
        "relationship_counts",
    }


def test_citation_template_serializer_shape_is_stable():
    payload = serialize_citation_template(
        {
            "id": "template-1",
            "name": "Custom",
            "template_body": "{author}. {title}",
            "is_default": True,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        }
    )
    assert set(payload.keys()) == {"id", "name", "template_body", "is_default", "created_at", "updated_at"}
