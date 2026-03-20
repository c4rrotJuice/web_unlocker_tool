import test from "node:test";
import assert from "node:assert/strict";

import { createResearchHarness } from "./helpers/research_dom_harness.mjs";

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function okEnvelope(data, meta = {}) {
  return { status: 200, body: { ok: true, data, meta, error: null } };
}

function graphEnvelope(nodeType, nodeData, collections) {
  return okEnvelope({
    node: { type: nodeType, id: nodeData.id, data: nodeData },
    collections,
    edges: [],
  });
}

test("research shell runtime drives list, graph detail, related navigation, load more, and honest fallback states", async () => {
  const harness = createResearchHarness();
  const { elements, requests, window } = harness;

  const sourceA = {
    id: "source-a",
    title: "Source A",
    container_title: "Container A",
    canonical_url: "https://example.com/a",
    hostname: "example.com",
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
    relationship_counts: { citation_count: 2 },
  };
  const sourceB = {
    id: "source-b",
    title: "Source B",
    container_title: "Container B",
    canonical_url: "https://example.com/b",
    hostname: "example.com",
    created_at: "2026-03-21T00:00:00+00:00",
    updated_at: "2026-03-21T00:00:00+00:00",
    relationship_counts: { citation_count: 1 },
  };
  const citationA = {
    id: "citation-a",
    source_id: "source-a",
    source: sourceA,
    excerpt: "Citation excerpt",
    renders: { mla: { bibliography: "Source A bibliography" } },
    relationship_counts: { quote_count: 1, note_count: 1, document_count: 1 },
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
  };
  const citationB = {
    id: "citation-b",
    source_id: "source-b",
    source: sourceB,
    excerpt: "Citation B excerpt",
    renders: { mla: { bibliography: "Source B bibliography" } },
    relationship_counts: { quote_count: 0, note_count: 0, document_count: 0 },
    created_at: "2026-03-21T00:00:00+00:00",
    updated_at: "2026-03-21T00:00:00+00:00",
  };
  const quoteA = {
    id: "quote-a",
    excerpt: "Quote A",
    citation: citationA,
    note_ids: ["note-a"],
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
  };
  const noteA = {
    id: "note-a",
    title: "Note A",
    note_body: "Note body A",
    status: "active",
    citation_id: "citation-a",
    quote_id: "quote-a",
    sources: [{ id: "note-source-a", source_id: "source-a", title: "Source A" }],
    tags: [{ id: "tag-a", name: "Evidence" }],
    linked_note_ids: [],
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
  };
  const documentA = {
    id: "doc-a",
    title: "Draft A",
    status: "active",
    attached_citation_ids: ["citation-a"],
    updated_at: "2026-03-20T00:00:00+00:00",
    created_at: "2026-03-20T00:00:00+00:00",
    tags: [],
  };

  const routeCounts = { quotes: 0, notes: 0, citations: 0 };

  harness.route((path) => path === "/api/sources?limit=20", async () => okEnvelope([sourceA], { has_more: false, next_cursor: null }));
  harness.route((path) => path === "/api/research/source/source-a/graph", async () => graphEnvelope("source", sourceA, {
    sources: [sourceA],
    citations: [citationA],
    quotes: [quoteA],
    notes: [noteA],
    documents: [documentA],
  }));
  harness.route((path) => path === "/api/research/citation/citation-a/graph", async () => graphEnvelope("citation", citationA, {
    sources: [sourceA],
    citations: [citationA],
    quotes: [quoteA],
    notes: [noteA],
    documents: [documentA],
  }));
  harness.route((path) => path === "/api/research/note/note-a/graph", async () => graphEnvelope("note", noteA, {
    sources: [sourceA],
    citations: [citationA],
    quotes: [quoteA],
    notes: [noteA],
    documents: [documentA],
  }));
  harness.route((path) => path === "/api/citations?limit=20", async () => {
    routeCounts.citations += 1;
    return okEnvelope([citationA], { has_more: true, next_cursor: "cursor-2" });
  });
  harness.route((path) => path === "/api/citations?limit=20&cursor=cursor-2", async () => okEnvelope([citationB], { has_more: false, next_cursor: null }));
  harness.route((path) => path === "/api/quotes?limit=20", async () => {
    routeCounts.quotes += 1;
    if (routeCounts.quotes === 1) {
      return okEnvelope([], { has_more: false, next_cursor: null });
    }
    return { status: 500, body: { detail: "Quotes failed" } };
  });
  harness.route((path) => path === "/api/notes?limit=20", async () => {
    routeCounts.notes += 1;
    if (routeCounts.notes === 1) {
      return okEnvelope([], { has_more: false, next_cursor: null });
    }
    return okEnvelope([noteA], { has_more: false, next_cursor: null });
  });

  const module = await import(`../../app/static/js/app_shell/pages/research.js?runtime=${Date.now()}`);
  const initPromise = module.initResearch();
  await initPromise;

  assert.match(elements.listRegion.innerHTML, /Source A/);
  assert.equal(elements.projectInput.disabled, true);
  assert.equal(elements.tagInput.disabled, true);

  const sourceCard = elements.listRegion.querySelectorAll(".research-card")[0];
  sourceCard.click();
  await flush(1);

  assert.match(elements.contextBody.innerHTML, /Loading related research neighborhood/);
  await flush();
  assert.match(elements.contextBody.innerHTML, /Citations/);
  assert.match(elements.contextBody.innerHTML, /Quotes/);
  assert.match(elements.contextBody.innerHTML, /Notes/);
  assert.match(elements.contextBody.innerHTML, /Documents using this source/);
  assert.match(elements.contextBody.innerHTML, /Open in editor/);
  assert.ok(requests.includes("/api/research/source/source-a/graph"));

  const relatedCitation = elements.contextBody.querySelector('[data-related-entity-id="citation-a"]');
  relatedCitation.click();
  await flush();
  assert.equal(window.location.search.includes("tab=citations"), true);
  assert.equal(window.location.search.includes("selected=citation-a"), true);
  assert.ok(requests.includes("/api/research/citation/citation-a/graph"));
  assert.match(elements.contextBody.innerHTML, /Documents using this citation/);

  const citationTab = harness.getTabButton("citations");
  citationTab.click();
  await flush();
  assert.match(elements.listRegion.innerHTML, /Source A/);
  assert.match(elements.listRegion.innerHTML, /Load more/);

  const loadMoreButton = elements.listRegion.querySelector("[data-research-load-more]");
  loadMoreButton.click();
  await flush();
  assert.match(elements.listRegion.innerHTML, /citation-b/);

  harness.getTabButton("quotes").click();
  await flush();
  assert.match(elements.listRegion.innerHTML, /No quotes yet/);

  harness.getTabButton("quotes").click();
  await flush();
  assert.match(elements.listRegion.innerHTML, /Quotes failed/);
  const retryButton = elements.listRegion.querySelector("[data-retry-button]");
  assert.ok(retryButton);

  harness.getTabButton("notes").click();
  await flush();
  assert.match(elements.listRegion.innerHTML, /No notes yet/);
  assert.equal(elements.projectInput.disabled, false);
  assert.equal(elements.tagInput.disabled, false);

  elements.queryInput.value = "";
  elements.form.dispatchEvent({ type: "submit", target: elements.form });
  await flush();
  assert.match(elements.listRegion.innerHTML, /Note A/);

  const noteCard = elements.listRegion.querySelectorAll(".research-card")[0];
  noteCard.click();
  await flush();
  const documentLink = elements.contextBody.querySelector('[data-related-document-id="doc-a"]');
  assert.ok(documentLink);
  documentLink.click();
  assert.equal(window.location.href, "/editor?document_id=doc-a");
});
