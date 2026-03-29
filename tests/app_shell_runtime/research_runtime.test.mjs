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

function buildFixture() {
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
  const quoteB = {
    id: "quote-b",
    excerpt: "Quote B",
    citation: citationB,
    note_ids: [],
    created_at: "2026-03-21T00:00:00+00:00",
    updated_at: "2026-03-21T00:00:00+00:00",
  };
  const noteA = {
    id: "note-a",
    title: "Note A",
    note_body: "Note body A",
    status: "active",
    citation_id: "citation-a",
    quote_id: "quote-a",
    sources: [{ id: "note-source-a", source_id: "source-a", citation_id: "citation-a", title: "Source A" }],
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

  return {
    sourceA,
    sourceB,
    citationA,
    citationB,
    quoteA,
    quoteB,
    noteA,
    documentA,
  };
}

test("research page auto-activates the first asset and keeps the context panel visible by default", async () => {
  const harness = createResearchHarness();
  const { elements, requests } = harness;
  const fixture = buildFixture();

  harness.route("/api/sources?limit=20", async () => okEnvelope([fixture.sourceA, fixture.sourceB], { has_more: false, next_cursor: null }));
  harness.route("/api/research/source/source-a/graph", async () => graphEnvelope("source", fixture.sourceA, {
    sources: [fixture.sourceA],
    citations: [fixture.citationA],
    quotes: [fixture.quoteA],
    notes: [fixture.noteA],
    documents: [fixture.documentA],
  }));

  const module = await import(`../../app/static/js/app_shell/pages/research.js?runtime=${Date.now()}`);
  await module.initResearch();
  await flush();

  assert.equal(harness.window.location.search.includes("selected=source-a"), true);
  assert.equal(elements.frame.classList.contains("has-context"), true);
  assert.match(elements.listRegion.innerHTML, /is-selected/);
  assert.match(elements.contextBody.innerHTML, /Linked citations/);
  assert.match(elements.contextBody.innerHTML, /Linked quotes/);
  assert.match(elements.contextBody.innerHTML, /Linked notes/);
  assert.match(elements.contextBody.innerHTML, /Linked documents/);
  assert.ok(requests.includes("/api/research/source/source-a/graph"));
});

test("selecting a different asset updates the context panel immediately", async () => {
  const harness = createResearchHarness();
  const { elements } = harness;
  const fixture = buildFixture();

  harness.route("/api/sources?limit=20", async () => okEnvelope([fixture.sourceA, fixture.sourceB], { has_more: false, next_cursor: null }));
  harness.route("/api/research/source/source-a/graph", async () => graphEnvelope("source", fixture.sourceA, {
    sources: [fixture.sourceA],
    citations: [fixture.citationA],
    quotes: [fixture.quoteA],
    notes: [fixture.noteA],
    documents: [fixture.documentA],
  }));
  harness.route("/api/research/source/source-b/graph", async () => graphEnvelope("source", fixture.sourceB, {
    sources: [fixture.sourceB],
    citations: [fixture.citationB],
    quotes: [fixture.quoteB],
    notes: [],
    documents: [],
  }));

  const module = await import(`../../app/static/js/app_shell/pages/research.js?runtime=${Date.now()}`);
  await module.initResearch();
  await flush();

  const cards = elements.listRegion.querySelectorAll(".research-card");
  cards[1].click();
  await flush(1);
  assert.equal(harness.window.location.search.includes("selected=source-b"), true);
  assert.match(elements.contextBody.innerHTML, /Source B/);
  assert.match(elements.contextBody.innerHTML, /Loading related research neighborhood/);

  await flush();
  assert.match(elements.contextBody.innerHTML, /Linked citations/);
  assert.doesNotMatch(elements.contextBody.innerHTML, /Note A/);
});

test("selection stays stable across filter refreshes and the next tab auto-selects its first asset", async () => {
  const harness = createResearchHarness();
  const { elements } = harness;
  const fixture = buildFixture();

  harness.route("/api/sources?limit=20", async () => okEnvelope([fixture.sourceA, fixture.sourceB], { has_more: false, next_cursor: null }));
  harness.route("/api/sources?limit=20&query=source", async () => okEnvelope([fixture.sourceA, fixture.sourceB], { has_more: false, next_cursor: null }));
  harness.route("/api/research/source/source-a/graph", async () => graphEnvelope("source", fixture.sourceA, {
    sources: [fixture.sourceA],
    citations: [fixture.citationA],
    quotes: [fixture.quoteA],
    notes: [fixture.noteA],
    documents: [fixture.documentA],
  }));
  harness.route("/api/research/source/source-b/graph", async () => graphEnvelope("source", fixture.sourceB, {
    sources: [fixture.sourceB],
    citations: [fixture.citationB],
    quotes: [fixture.quoteB],
    notes: [],
    documents: [],
  }));
  harness.route("/api/citations?limit=20", async () => okEnvelope([fixture.citationA], { has_more: false, next_cursor: null }));
  harness.route("/api/citations?limit=20&search=source", async () => okEnvelope([fixture.citationA], { has_more: false, next_cursor: null }));
  harness.route("/api/research/citation/citation-a/graph", async () => graphEnvelope("citation", fixture.citationA, {
    sources: [fixture.sourceA],
    citations: [fixture.citationA],
    quotes: [fixture.quoteA],
    notes: [fixture.noteA],
    documents: [fixture.documentA],
  }));

  const module = await import(`../../app/static/js/app_shell/pages/research.js?runtime=${Date.now()}`);
  await module.initResearch();
  await flush();

  elements.listRegion.querySelectorAll(".research-card")[1].click();
  await flush();
  assert.equal(harness.window.location.search.includes("selected=source-b"), true);

  elements.queryInput.value = "source";
  elements.form.dispatchEvent({ type: "submit", target: elements.form });
  await flush();
  assert.equal(harness.window.location.search.includes("selected=source-b"), true);
  assert.match(elements.contextBody.innerHTML, /Source B/);

  harness.getTabButton("citations").click();
  await flush();
  assert.equal(harness.window.location.search.includes("tab=citations"), true);
  assert.equal(harness.window.location.search.includes("selected=citation-a"), true);
  assert.match(elements.contextBody.innerHTML, /Linked sources/);
  assert.match(elements.contextBody.innerHTML, /Linked documents/);
});

test("empty states keep the context panel open and render honest relationship-free copy", async () => {
  const harness = createResearchHarness();
  const { elements } = harness;

  harness.route("/api/sources?limit=20", async () => okEnvelope([], { has_more: false, next_cursor: null }));

  const module = await import(`../../app/static/js/app_shell/pages/research.js?runtime=${Date.now()}`);
  await module.initResearch();
  await flush();

  assert.equal(elements.frame.classList.contains("has-context"), true);
  assert.match(elements.listRegion.innerHTML, /No sources yet/);
  assert.match(elements.contextBody.innerHTML, /No active source/);
  assert.match(elements.contextBody.innerHTML, /No sources match the current view yet/);
});
