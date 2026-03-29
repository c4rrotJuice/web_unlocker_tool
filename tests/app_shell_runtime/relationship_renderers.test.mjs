import test from "node:test";
import assert from "node:assert/strict";

import {
  renderDocumentRelationshipDetail,
  renderCitationDetail,
  renderNoteDetail,
  renderProjectDetail,
  renderQuoteDetail,
  renderSourceDetail,
} from "../../app/static/js/app_shell/renderers/details.js";

test("note detail renders grouped evidence and related notes from backend relationship groups", () => {
  const html = renderNoteDetail({
    id: "note-1",
    title: "Claim note",
    note_body: "Body",
    status: "active",
    updated_at: "2026-03-20T00:00:00+00:00",
    tags: [],
    attached_documents: [{ id: "doc-1", title: "Draft chapter", status: "active" }],
    relationship_groups: {
      evidence_links_by_role: {
        primary: [{ title: "Primary source", hostname: "example.test", display: { label: "Primary source" } }],
        supporting: [{ title: "Support study", hostname: "support.test", display: { label: "Support study" } }],
        background: [],
      },
      note_links_by_type: {
        supports: [{ link: { linked_note_id: "note-2" }, note: { id: "note-2", title: "Supporting note", status: "active" } }],
        contradicts: [],
        extends: [],
        related: [{ link: { linked_note_id: "note-3" }, note: { id: "note-3", title: "Related note", status: "draft" } }],
      },
    },
  }, {
    authoring: { supported: true, panel: null },
  });

  assert.match(html, /Primary evidence/);
  assert.match(html, /Supporting evidence/);
  assert.match(html, /Background reading/);
  assert.match(html, /Supports/);
  assert.match(html, /Related/);
  assert.match(html, /Attached documents/);
  assert.match(html, /Author relationships/);
  assert.match(html, /Link note/);
  assert.match(html, /Primary source/);
  assert.match(html, /Supporting note/);
  assert.match(html, /Edit/);
  assert.match(html, /Remove/);
});

test("note detail keeps unsupported grouped relationship sections hidden and shows calm empty states when supported but empty", () => {
  const unsupportedHtml = renderNoteDetail({
    id: "note-2",
    title: "Summary note",
    note_body: "Body",
    status: "active",
    tags: [],
  }, {
    authoring: { supported: true, panel: null },
  });
  assert.match(unsupportedHtml, /Author relationships/);
  assert.doesNotMatch(unsupportedHtml, /Related notes/);
  assert.doesNotMatch(unsupportedHtml, /Evidence/);
  assert.doesNotMatch(unsupportedHtml, /Attached documents/);

  const emptyHtml = renderNoteDetail({
    id: "note-3",
    title: "Empty note",
    note_body: "Body",
    status: "active",
    tags: [],
    attached_documents: [],
    relationship_groups: {
      evidence_links_by_role: { primary: [], supporting: [], background: [] },
      note_links_by_type: { supports: [], contradicts: [], extends: [], related: [] },
    },
  }, {
    authoring: { supported: true, panel: null },
  });
  assert.match(emptyHtml, /No attached evidence yet\./);
  assert.match(emptyHtml, /No related notes yet\./);
  assert.match(emptyHtml, /This note is not attached to any documents yet\./);
});

test("source and citation details expose note-hub handoff while quote detail exposes quote-to-note conversion", () => {
  const sourceHtml = renderSourceDetail({
    id: "source-1",
    title: "Source A",
    canonical_url: "https://example.test/source",
    hostname: "example.test",
    relationship_counts: {},
  }, {
    noteHubLink: {
      supported: true,
      targetKind: "source",
      targetId: "source-1",
      targetLabel: "Source A",
    },
  });
  const citationHtml = renderCitationDetail({
    id: "citation-1",
    source: { id: "source-1", title: "Source A", hostname: "example.test", canonical_url: "https://example.test/source" },
    renders: { mla: { bibliography: "Source A" } },
    primary_render: { style: "mla", kind: "bibliography", text: "Source A" },
  }, {
    noteHubLink: {
      supported: true,
      targetKind: "citation",
      targetId: "citation-1",
      targetLabel: "Source A",
    },
  });
  const quoteHtml = renderQuoteDetail({
    id: "quote-1",
    excerpt: "Quoted line",
    citation: { source: { title: "Source A", hostname: "example.test" } },
    note_ids: ["note-1"],
    neighborhood: {
      notes: [{ id: "note-1", title: "Converted note", note_body: "Body", status: "active", tags: [] }],
    },
  }, {
    convertAction: {
      supported: true,
      label: "Convert to note",
    },
  });
  assert.match(sourceHtml, /Link to note…/);
  assert.match(citationHtml, /Link to note…/);
  assert.match(quoteHtml, /Convert to note/);
  assert.match(quoteHtml, /Derived notes/);
  assert.match(quoteHtml, /Converted note/);
  assert.doesNotMatch(quoteHtml, /Link to note…/);
});

test("note detail surfaces lineage and editor insert follow-up actions when available", () => {
  const html = renderNoteDetail({
    id: "note-1",
    title: "Converted note",
    note_body: "Body",
    status: "active",
    tags: [],
    attached_documents: [{ id: "doc-1", title: "Draft chapter", status: "active" }],
    lineage: {
      citation: {
        id: "citation-1",
        source: { id: "source-1", title: "Source A", hostname: "example.test", canonical_url: "https://example.test/source" },
        renders: { mla: { bibliography: "Source A" } },
        primary_render: { style: "mla", kind: "bibliography", text: "Source A" },
      },
      quote: {
        id: "quote-1",
        excerpt: "Quoted line",
        citation: { source: { title: "Source A", hostname: "example.test" } },
        note_ids: ["note-1"],
      },
    },
  }, {
    insertAction: { supported: true, label: "Insert note" },
    authoring: { supported: true, panel: null },
  });

  assert.match(html, /Lineage/);
  assert.match(html, /From citation/);
  assert.match(html, /From quote/);
  assert.match(html, /Insert note/);
});

test("document relationship detail distinguishes attached and derived research sections", () => {
  const html = renderDocumentRelationshipDetail(
    {
      id: "doc-1",
      title: "Draft chapter",
      status: "active",
      updated_at: "2026-03-20T00:00:00+00:00",
    },
    {
      citations: [{ id: "citation-1", source: { id: "source-1", title: "Source A", hostname: "example.test" }, renders: { mla: { bibliography: "Source A" } }, primary_render: { style: "mla", kind: "bibliography", text: "Source A" } }],
      notes: [{ id: "note-1", title: "Claim note", note_body: "Body", status: "active", tags: [] }],
      quotes: [{ id: "quote-1", excerpt: "Quoted line", citation: { source: { title: "Source A", hostname: "example.test" } }, note_ids: [] }],
      sources: [{ id: "source-1", title: "Source A", hostname: "example.test", canonical_url: "https://example.test", relationship_counts: {} }],
    },
  );

  assert.match(html, /Attached citations/);
  assert.match(html, /Attached notes/);
  assert.match(html, /Inserted quotes/);
  assert.match(html, /Derived sources/);
  assert.match(html, /attached relationships stay distinct from research derived/i);
});

test("project detail renders derived metrics without implying direct ownership of research entities", () => {
  const html = renderProjectDetail({
    id: "project-1",
    name: "Policy memo",
    description: "Connected writing work.",
    color: "#224466",
    updated_at: "2026-03-20T00:00:00+00:00",
    relationship_counts: {
      note_count: 2,
      document_count: 1,
      derived_citation_count: 3,
      derived_source_count: 2,
    },
    recent_activity: [
      { entity_type: "document", label: "Outline draft" },
      { entity_type: "note", label: "Evidence note" },
    ],
  });

  assert.match(html, /derived citations/i);
  assert.match(html, /derived sources/i);
  assert.match(html, /Contained work/);
  assert.match(html, /Derived research visibility/);
  assert.match(html, /Recent activity/);
  assert.match(html, /document · Outline draft/);
  assert.doesNotMatch(html, /Link to note…/);
  assert.doesNotMatch(html, /Link source as evidence/);
});
