import test from "node:test";
import assert from "node:assert/strict";

import { createProjectsHarness } from "./helpers/research_dom_harness.mjs";

let importCounter = 0;

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function okEnvelope(data, meta = {}) {
  return { status: 200, body: { ok: true, data, meta, error: null } };
}

function buildProjectFixture() {
  const project = {
    id: "project-1",
    name: "Policy memo",
    description: "Connected writing work.",
    color: "#224466",
    updated_at: "2026-03-20T00:00:00+00:00",
    relationship_counts: {
      note_count: 1,
      document_count: 1,
      derived_citation_count: 2,
      derived_source_count: 2,
    },
    recent_activity: [
      { entity_type: "document", title: "Draft chapter" },
      { entity_type: "note", title: "Claim note" },
    ],
  };
  const note = {
    id: "note-1",
    title: "Claim note",
    note_body: "Body",
    project_id: "project-1",
    project: { id: "project-1", name: "Policy memo" },
    status: "active",
    tags: [],
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
  };
  const document = {
    id: "doc-1",
    title: "Draft chapter",
    project_id: "project-1",
    project: { id: "project-1", name: "Policy memo" },
    status: "active",
    attached_citation_ids: [],
    attached_note_ids: [],
    tags: [],
    revision: "2026-03-20T00:00:00+00:00",
    created_at: "2026-03-20T00:00:00+00:00",
    updated_at: "2026-03-20T00:00:00+00:00",
  };
  return { project, note, document };
}

test("project detail renders contained work and derived research visibility separately", async () => {
  const harness = createProjectsHarness();
  const { elements } = harness;
  const fixture = buildProjectFixture();

  harness.route("/api/projects?include_archived=false&limit=24", async () => okEnvelope([fixture.project]));
  harness.route("/api/projects/project-1", async () => okEnvelope(fixture.project));
  harness.route("/api/notes?project_id=project-1&limit=6", async () => okEnvelope([fixture.note]));
  harness.route("/api/docs?project_id=project-1&limit=6", async () => okEnvelope([fixture.document]));

  const module = await import(`../../app/static/js/app_shell/pages/projects.js?runtime=${importCounter += 1}`);
  await module.initProjects({ page_state: { project_id: "project-1" } });
  await flush();

  assert.match(elements.sourcesNode.innerHTML, /Contained work/);
  assert.match(elements.sourcesNode.innerHTML, /Derived research visibility/);
  assert.match(elements.sourcesNode.innerHTML, /Projects do not directly own sources, citations, or quotes/);
  assert.match(elements.notesNode.innerHTML, /Claim note/);
  assert.match(elements.documentsNode.innerHTML, /Draft chapter/);
});

test("project create and move flows use canonical note and document project assignment endpoints", async () => {
  const harness = createProjectsHarness();
  const { elements, requests } = harness;
  const fixture = buildProjectFixture();
  const notes = [fixture.note];
  const documents = [fixture.document];

  harness.route("/api/projects?include_archived=false&limit=24", async () => okEnvelope([fixture.project, { ...fixture.project, id: "project-2", name: "Secondary" }]));
  harness.route("/api/projects/project-1", async () => okEnvelope({
    ...fixture.project,
    relationship_counts: {
      note_count: notes.length,
      document_count: documents.length,
      derived_citation_count: 2,
      derived_source_count: 2,
    },
  }));
  harness.route("/api/notes?project_id=project-1&limit=6", async () => okEnvelope(notes));
  harness.route("/api/docs?project_id=project-1&limit=6", async () => okEnvelope(documents));
  harness.route("/api/notes", async (_path, options) => {
    const created = {
      ...fixture.note,
      id: "note-new",
      title: options.body.title,
      note_body: options.body.note_body,
      project_id: options.body.project_id,
    };
    notes.push(created);
    return okEnvelope(created);
  });
  harness.route("/api/docs", async (_path, options) => {
    const created = {
      ...fixture.document,
      id: "doc-new",
      title: options.body.title,
      project_id: options.body.project_id,
      revision: "2026-03-21T00:00:00+00:00",
      updated_at: "2026-03-21T00:00:00+00:00",
    };
    documents.push(created);
    return okEnvelope(created);
  });
  harness.route("/api/notes/note-1", async (_path, options) => {
    fixture.note.project_id = options.body.project_id;
    notes.splice(0, notes.length, ...notes.filter((row) => row.id !== "note-1"));
    return okEnvelope({ ...fixture.note });
  });
  harness.route("/api/docs/doc-1", async (_path, options) => {
    fixture.document.project_id = options.body.project_id;
    documents.splice(0, documents.length, ...documents.filter((row) => row.id !== "doc-1"));
    return okEnvelope({ ...fixture.document, revision: "2026-03-22T00:00:00+00:00" });
  });

  const module = await import(`../../app/static/js/app_shell/pages/projects.js?runtime=${importCounter += 1}`);
  await module.initProjects({ page_state: { project_id: "project-1" } });
  await flush();

  elements.heroMeta.querySelector("[data-project-note-title]").value = "New note";
  elements.heroMeta.querySelector("[data-project-note-body]").value = "New note body";
  elements.heroMeta.querySelector("[data-project-create-note]").click();
  await flush();

  elements.heroMeta.querySelector("[data-project-document-title]").value = "New document";
  elements.heroMeta.querySelector("[data-project-create-document]").click();
  await flush();

  const noteSelect = elements.notesNode.querySelector('[data-project-assignment-select="note:note-1"]');
  noteSelect.value = "project-2";
  elements.notesNode.querySelector('[data-project-assignment-save="note:note-1"]').click();
  await flush();

  const documentSelect = elements.documentsNode.querySelector('[data-project-assignment-select="document:doc-1"]');
  documentSelect.value = "";
  elements.documentsNode.querySelector('[data-project-assignment-save="document:doc-1"]').click();
  await flush();

  assert.ok(requests.some((request) => request.path === "/api/notes" && request.options.method === "POST" && request.options.body.project_id === "project-1"));
  assert.ok(requests.some((request) => request.path === "/api/docs" && request.options.method === "POST" && request.options.body.project_id === "project-1"));
  assert.ok(requests.some((request) => request.path === "/api/notes/note-1" && request.options.method === "PATCH" && request.options.body.project_id === "project-2"));
  assert.ok(requests.some((request) => request.path === "/api/docs/doc-1" && request.options.method === "PATCH" && request.options.body.project_id === null));
  assert.doesNotMatch(elements.notesNode.innerHTML, /Claim note/);
  assert.doesNotMatch(elements.documentsNode.innerHTML, /Draft chapter/);
});
