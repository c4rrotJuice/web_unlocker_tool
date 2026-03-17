from app.core.serialization import (
    serialize_document,
    serialize_document_hydration,
    serialize_note,
    serialize_note_source,
    serialize_outline,
    serialize_quote,
)


def test_note_source_serializer_shape_is_explicit_and_stable():
    payload = serialize_note_source(
        {
            "id": "rel-1",
            "source_id": "source-1",
            "citation_id": "citation-1",
            "relation_type": "citation",
            "url": "https://example.com",
            "hostname": "example.com",
            "title": "Example",
            "source_author": "Ada",
            "source_published_at": "2026-01-01T00:00:00+00:00",
            "display": {"label": "Example", "subtitle": "example.com"},
            "attached_at": "2026-01-02T00:00:00+00:00",
            "position": 0,
        }
    )
    assert set(payload.keys()) == {
        "id",
        "source_id",
        "citation_id",
        "relation_type",
        "url",
        "hostname",
        "title",
        "source_author",
        "source_published_at",
        "display",
        "attached_at",
        "position",
    }


def test_quote_note_document_serializers_exclude_legacy_fields():
    quote = serialize_quote(
        {
            "id": "quote-1",
            "excerpt": "Quoted text",
            "locator": {"page": 2},
            "annotation": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        },
        citation={"id": "citation-1", "source": {"id": "source-1"}},
        note_ids=["note-1"],
    )
    note = serialize_note(
        {
            "id": "note-1",
            "title": "Synthesis",
            "note_body": "Body",
            "highlight_text": "Highlight",
            "project_id": "project-1",
            "citation_id": "citation-1",
            "quote_id": "quote-1",
            "status": "active",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        },
        tags=[{"id": "tag-1", "name": "evidence", "normalized_name": "evidence"}],
        linked_note_ids=["note-2"],
        sources=[serialize_note_source({"id": "rel-1", "relation_type": "external", "display": {}, "position": 0})],
    )
    document = serialize_document(
        {
            "id": "doc-1",
            "title": "Draft",
            "content_delta": {"ops": [{"insert": "Hello\n"}]},
            "content_html": "<p>Hello</p>",
            "project_id": "project-1",
            "status": "active",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-02T00:00:00+00:00",
        },
        attached_citation_ids=["citation-1"],
        attached_note_ids=["note-1"],
        tag_ids=["tag-1"],
        tags=[{"id": "tag-1", "name": "evidence", "normalized_name": "evidence"}],
        can_edit=True,
        allowed_export_formats=["html", "pdf"],
    )

    assert "citation" in quote
    assert "citation_ids" not in document
    assert note["tags"][0]["id"] == "tag-1"
    assert document["attached_citation_ids"] == ["citation-1"]
    assert document["attached_note_ids"] == ["note-1"]
    assert document["tag_ids"] == ["tag-1"]
    assert document["status"] == "active"
    assert document["archived"] is False


def test_hydration_and_outline_payload_shapes_are_stable():
    hydration = serialize_document_hydration(
        document={"id": "doc-1"},
        attached_citations=[{"id": "citation-1"}],
        attached_notes=[{"id": "note-1"}],
        attached_quotes=[],
        attached_sources=[],
        seed=None,
    )
    outline = serialize_outline([{"level": 1, "text": "Heading", "anchor": "heading"}])
    assert set(hydration.keys()) == {"document", "attached_citations", "attached_notes", "attached_quotes", "attached_sources", "seed"}
    assert outline == {"items": [{"level": 1, "text": "Heading", "anchor": "heading"}]}
