from app.core.serialization import (
    serialize_document,
    serialize_document_hydration,
    serialize_note_evidence_link,
    serialize_note_link,
    serialize_note,
    serialize_outline,
    serialize_quote,
)


def test_note_evidence_and_link_serializer_shapes_are_explicit_and_stable():
    payload = serialize_note_evidence_link(
        {
            "id": "rel-1",
            "target_kind": "citation",
            "evidence_role": "primary",
            "source_id": "source-1",
            "citation_id": "citation-1",
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
        "target_kind",
        "evidence_role",
        "source_id",
        "citation_id",
        "url",
        "hostname",
        "title",
        "source_author",
        "source_published_at",
        "display",
        "attached_at",
        "position",
    }
    note_link = serialize_note_link({"linked_note_id": "note-2", "link_type": "supports", "created_at": "2026-01-02T00:00:00+00:00"})
    assert note_link == {"linked_note_id": "note-2", "link_type": "supports", "created_at": "2026-01-02T00:00:00+00:00"}


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
        note_links=[serialize_note_link({"linked_note_id": "note-2", "link_type": "related", "created_at": "2026-01-02T00:00:00+00:00"})],
        evidence_links=[serialize_note_evidence_link({"id": "rel-1", "target_kind": "external", "evidence_role": "background", "display": {}, "position": 0})],
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
    assert note["note_links"][0]["link_type"] == "related"
    assert note["evidence_links"][0]["evidence_role"] == "background"
    assert note["lineage"]["citation_id"] == "citation-1"
    assert note["lineage"]["quote_id"] == "quote-1"
    assert note["lineage"]["citation"] is None
    assert note["lineage"]["quote"] is None
    assert note["lineage"]["evidence_source_ids"] == []
    assert note["lineage"]["evidence_citation_ids"] == []
    assert document["attached_citation_ids"] == ["citation-1"]
    assert document["attached_note_ids"] == ["note-1"]
    assert document["tag_ids"] == ["tag-1"]
    assert document["status"] == "active"
    assert document["archived"] is False


def test_hydration_and_outline_payload_shapes_are_stable():
    hydration = serialize_document_hydration(
        document={"id": "doc-1"},
        attached_citations=[{"id": "citation-1", "primary_render": {"style": "mla", "kind": "bibliography", "text": "Source"}}],
        attached_notes=[{"id": "note-1"}],
        attached_quotes=[],
        derived_sources=[],
        seed=None,
    )
    outline = serialize_outline([{"level": 1, "text": "Heading", "anchor": "heading"}])
    assert set(hydration.keys()) == {"document", "attached_citations", "attached_notes", "attached_quotes", "derived_sources", "seed"}
    assert hydration["attached_citations"][0]["primary_render"]["kind"] == "bibliography"
    assert outline == {"items": [{"level": 1, "text": "Heading", "anchor": "heading"}]}
