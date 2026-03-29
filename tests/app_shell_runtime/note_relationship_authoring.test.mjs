import test from "node:test";
import assert from "node:assert/strict";

import { createNoteRelationshipAuthoringController } from "../../app/static/js/shared/note_relationship_authoring.js";
import { renderNoteDetail } from "../../app/static/js/app_shell/renderers/details.js";

function createApi() {
  const notes = new Map([
    ["note-1", {
      id: "note-1",
      title: "Claim note",
      project_id: "project-1",
      note_links: [],
      evidence_links: [],
      relationship_groups: {
        note_links_by_type: { supports: [], contradicts: [], extends: [], related: [] },
        evidence_links_by_role: { primary: [], supporting: [], background: [] },
      },
    }],
    ["note-2", {
      id: "note-2",
      title: "Support note",
      project_id: "project-1",
      note_links: [],
      evidence_links: [],
    }],
  ]);
  const replaceNoteLinksCalls = [];
  const replaceNoteSourcesCalls = [];
  return {
    notes,
    replaceNoteLinksCalls,
    replaceNoteSourcesCalls,
    async listNotes() {
      return Array.from(notes.values());
    },
    async getNote(noteId) {
      return notes.get(noteId);
    },
    async listSources() {
      return [{
        id: "source-1",
        title: "Source One",
        hostname: "example.test",
        canonical_url: "https://example.test/source-1",
      }];
    },
    async listCitations() {
      return [{
        id: "citation-1",
        excerpt: "Citation excerpt",
        source: {
          id: "source-1",
          title: "Source One",
          hostname: "example.test",
          canonical_url: "https://example.test/source-1",
        },
      }];
    },
    async replaceNoteLinks(noteId, noteLinks) {
      replaceNoteLinksCalls.push({ noteId, noteLinks });
      const updated = {
        ...notes.get(noteId),
        note_links: noteLinks.map((row) => ({ ...row, created_at: "2026-03-29T00:00:00+00:00" })),
        relationship_groups: {
          note_links_by_type: {
            supports: noteLinks.filter((row) => row.link_type === "supports").map((row) => ({ link: row, note: notes.get(row.linked_note_id) })),
            contradicts: [],
            extends: [],
            related: noteLinks.filter((row) => row.link_type === "related").map((row) => ({ link: row, note: notes.get(row.linked_note_id) })),
          },
          evidence_links_by_role: { primary: [], supporting: [], background: [] },
        },
      };
      notes.set(noteId, updated);
      return updated;
    },
    async replaceNoteSources(noteId, evidenceLinks) {
      replaceNoteSourcesCalls.push({ noteId, evidenceLinks });
      const updated = {
        ...notes.get(noteId),
        evidence_links: evidenceLinks.map((row, index) => ({ ...row, id: row.id || `evidence-${index + 1}` })),
      };
      notes.set(noteId, updated);
      return updated;
    },
  };
}

test("controller creates a typed note-to-note link through note-owned replace semantics", async () => {
  const api = createApi();
  const updates = [];
  const controller = createNoteRelationshipAuthoringController({
    api,
    getNoteDetail: api.getNote,
    onNoteUpdated(note) {
      updates.push(note);
    },
  });

  await controller.handleClick({ noteAuthoringOpen: "note_link", noteId: "note-1" });
  await controller.handleClick({ noteAuthoringTarget: "note-2" });
  controller.handleChange({ noteAuthoringLinkType: "" }, "supports");
  await controller.handleClick({ noteAuthoringSave: "" });

  assert.deepEqual(api.replaceNoteLinksCalls, [{
    noteId: "note-1",
    noteLinks: [{ linked_note_id: "note-2", link_type: "supports" }],
  }]);
  assert.equal(updates.at(-1).note_links[0].link_type, "supports");
  assert.match(renderNoteDetail(updates.at(-1)), /Supporting note|Support note/);
});

test("controller removes a typed note-to-note link explicitly", async () => {
  const api = createApi();
  api.notes.set("note-1", {
    ...api.notes.get("note-1"),
    note_links: [{ linked_note_id: "note-2", link_type: "related", created_at: "2026-03-29T00:00:00+00:00" }],
  });
  const controller = createNoteRelationshipAuthoringController({
    api,
    getNoteDetail: api.getNote,
  });

  await controller.handleClick({ noteRelationRemove: "note-link", noteId: "note-1", relationKey: "note-2" });

  assert.deepEqual(api.replaceNoteLinksCalls, [{
    noteId: "note-1",
    noteLinks: [],
  }]);
});

test("controller creates source, citation, and external evidence links with typed evidence roles", async () => {
  const api = createApi();
  const controller = createNoteRelationshipAuthoringController({
    api,
    getNoteDetail: api.getNote,
  });

  await controller.handleClick({ noteAuthoringOpen: "source_evidence", noteId: "note-1" });
  await controller.handleClick({ noteAuthoringTarget: "source-1" });
  controller.handleChange({ noteAuthoringEvidenceRole: "" }, "background");
  await controller.handleClick({ noteAuthoringSave: "" });

  await controller.handleClick({ noteAuthoringOpen: "citation_evidence", noteId: "note-1" });
  await controller.handleClick({ noteAuthoringTarget: "citation-1" });
  controller.handleChange({ noteAuthoringEvidenceRole: "" }, "primary");
  await controller.handleClick({ noteAuthoringSave: "" });

  await controller.handleClick({ noteAuthoringOpen: "external_evidence", noteId: "note-1" });
  controller.handleChange({ noteAuthoringUrl: "" }, "https://example.test/background");
  controller.handleChange({ noteAuthoringTitle: "" }, "Background reading");
  controller.handleChange({ noteAuthoringEvidenceRole: "" }, "supporting");
  await controller.handleClick({ noteAuthoringSave: "" });

  assert.equal(api.replaceNoteSourcesCalls.length, 3);
  assert.deepEqual(api.replaceNoteSourcesCalls[0], {
    noteId: "note-1",
    evidenceLinks: [{
      target_kind: "source",
      evidence_role: "background",
      source_id: "source-1",
      citation_id: null,
      url: "https://example.test/source-1",
      hostname: "example.test",
      title: "Source One",
    }],
  });
  assert.deepEqual(api.replaceNoteSourcesCalls[1].evidenceLinks.at(-1), {
    target_kind: "citation",
    evidence_role: "primary",
    source_id: "source-1",
    citation_id: "citation-1",
    url: "https://example.test/source-1",
    hostname: "example.test",
    title: "Source One",
  });
  assert.deepEqual(api.replaceNoteSourcesCalls[2].evidenceLinks.at(-1), {
    target_kind: "external",
    evidence_role: "supporting",
    url: "https://example.test/background",
    title: "Background reading",
  });
});

test("controller rejects invalid types and roles cleanly before issuing replace calls", async () => {
  const api = createApi();
  const states = [];
  const controller = createNoteRelationshipAuthoringController({
    api,
    getNoteDetail: api.getNote,
    onStateChange(snapshot) {
      states.push(snapshot);
    },
  });

  await controller.handleClick({ noteAuthoringOpen: "note_link", noteId: "note-1" });
  await controller.handleClick({ noteAuthoringTarget: "note-2" });
  controller.handleChange({ noteAuthoringLinkType: "" }, "invalid");
  await controller.handleClick({ noteAuthoringSave: "" });

  await controller.handleClick({ noteAuthoringOpen: "external_evidence", noteId: "note-1" });
  controller.handleChange({ noteAuthoringUrl: "" }, "https://example.test/invalid");
  controller.handleChange({ noteAuthoringEvidenceRole: "" }, "invalid");
  await controller.handleClick({ noteAuthoringSave: "" });

  assert.equal(api.replaceNoteLinksCalls.length, 0);
  assert.equal(api.replaceNoteSourcesCalls.length, 0);
  assert.match(states.at(-1).panel.error, /Invalid note evidence role/);
});
