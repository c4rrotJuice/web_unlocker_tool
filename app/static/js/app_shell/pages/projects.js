import { apiFetchJson } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";
import { renderDocumentCard, renderNoteCard, renderProjectCard } from "../renderers/cards.js";
import { renderProjectDetail } from "../renderers/details.js";
import { renderProjectAssignmentControl } from "../renderers/project_organization.js";
import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";

let booted = false;

export async function initProjects(boot) {
  if (booted) return;
  booted = true;

  const listNode = document.getElementById("projects-list");
  const notesNode = document.getElementById("project-notes");
  const docsNode = document.getElementById("project-documents");
  const sourcesNode = document.getElementById("project-sources");
  const titleNode = document.getElementById("projects-hero-title");
  const copyNode = document.getElementById("projects-hero-copy");
  const heroMetaNode = document.getElementById("projects-hero-meta");
  const projectId = boot.page_state?.project_id || null;
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  let projectRows = [];
  let noteRows = [];
  let documentRows = [];
  let currentProject = null;

  function projectAssignmentLabel(entityType, nextProjectId) {
    const entityLabel = entityType === "document" ? "Document" : "Note";
    if (!nextProjectId) return `${entityLabel} removed from project`;
    return `${entityLabel} moved to project`;
  }

  function projectAssignmentDescription(nextProjectId) {
    if (!nextProjectId) return "This item is no longer assigned to a project.";
    const project = projectRows.find((row) => row?.id === nextProjectId);
    return project?.name ? `Now organized in ${project.name}.` : "Project assignment updated.";
  }

  renderLoading(listNode, "Loading projects…");
  if (projectId) {
    renderLoading(notesNode, "Loading project notes…");
    renderLoading(docsNode, "Loading project documents…");
  }

  function renderHeroMeta() {
    if (!projectId || !currentProject) {
      heroMetaNode.innerHTML = `<div class="surface-note">Select a project to create notes or documents inside it.</div>`;
      return;
    }
    heroMetaNode.innerHTML = `
      <section class="detail-section">
        <p class="section-kicker">Project workflows</p>
        <p class="surface-note">Create work inside this project or move contained work elsewhere. Project assignment stays organizational.</p>
        <div class="detail-chip-row">
          <label>
            <span class="surface-note">New note title</span>
            <input type="text" data-project-note-title placeholder="Project note" />
          </label>
          <label>
            <span class="surface-note">New note body</span>
            <input type="text" data-project-note-body placeholder="Capture the note you want to keep in this project" />
          </label>
          <button type="button" class="app-button-secondary" data-project-create-note>Create note</button>
        </div>
        <div class="detail-chip-row">
          <label>
            <span class="surface-note">New document title</span>
            <input type="text" data-project-document-title placeholder="Project draft" />
          </label>
          <button type="button" class="app-button-secondary" data-project-create-document>Create document</button>
        </div>
      </section>
    `;
  }

  function normalizeProjectSelects(root) {
    root?.querySelectorAll?.("[data-project-assignment-select]").forEach((select) => {
      select.value = select.dataset.currentProjectId || "";
    });
  }

  function bindMoveControls(root) {
    normalizeProjectSelects(root);
    root?.querySelectorAll?.("[data-project-assignment-save]").forEach((button) => {
      button.addEventListener("click", async () => {
        const entityType = button.dataset.entityType || "";
        const entityId = button.dataset.entityId || "";
        const select = root.querySelector(`[data-project-assignment-select="${entityType}:${entityId}"]`);
        if (!entityType || !entityId || !select) return;
        button.disabled = true;
        try {
          if (entityType === "note") {
            await window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(entityId)}`, {
              method: "PATCH",
              body: { project_id: select.value || null },
            });
          } else if (entityType === "document") {
            const row = documentRows.find((item) => item.id === entityId);
            await window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(entityId)}`, {
              method: "PATCH",
              body: {
                revision: row?.revision,
                project_id: select.value || null,
              },
            });
          }
          feedback.toast.success(projectAssignmentLabel(entityType, select.value || ""), {
            description: projectAssignmentDescription(select.value || ""),
          });
          await load();
        } catch (error) {
          feedback.toast.error("Move to project failed", {
            description: error.message || `Unable to move this ${entityType} to the selected project.`,
          });
          root.innerHTML = `<div class="surface-note">${error.message || `Unable to move ${entityType}.`}</div>` + root.innerHTML;
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function bindCreateControls() {
    const createNoteButton = heroMetaNode.querySelector("[data-project-create-note]");
    const createDocumentButton = heroMetaNode.querySelector("[data-project-create-document]");
    if (createNoteButton) {
      createNoteButton.addEventListener("click", async () => {
        const titleInput = heroMetaNode.querySelector("[data-project-note-title]");
        const bodyInput = heroMetaNode.querySelector("[data-project-note-body]");
        const noteBody = String(bodyInput?.value || "").trim();
        const noteTitle = String(titleInput?.value || "").trim() || noteBody.slice(0, 72) || "Project note";
        createNoteButton.disabled = true;
        try {
          await window.webUnlockerAuth.authJson("/api/notes", {
            method: "POST",
            body: {
              title: noteTitle,
              note_body: noteBody || noteTitle,
              highlight_text: null,
              project_id: projectId,
            },
          });
          if (titleInput) titleInput.value = "";
          if (bodyInput) bodyInput.value = "";
          await load();
        } catch (error) {
          heroMetaNode.innerHTML += `<div class="surface-note">${error.message || "Unable to create note."}</div>`;
        } finally {
          createNoteButton.disabled = false;
        }
      });
    }
    if (createDocumentButton) {
      createDocumentButton.addEventListener("click", async () => {
        const titleInput = heroMetaNode.querySelector("[data-project-document-title]");
        createDocumentButton.disabled = true;
        try {
          await window.webUnlockerAuth.authJson("/api/docs", {
            method: "POST",
            body: {
              title: String(titleInput?.value || "").trim() || "Project draft",
              project_id: projectId,
            },
          });
          if (titleInput) titleInput.value = "";
          await load();
        } catch (error) {
          heroMetaNode.innerHTML += `<div class="surface-note">${error.message || "Unable to create document."}</div>`;
        } finally {
          createDocumentButton.disabled = false;
        }
      });
    }
  }

  async function load() {
    try {
      projectRows = await apiFetchJson("/api/projects?include_archived=false&limit=24");
      if (projectRows.length) {
        listNode.innerHTML = `<div class="card-stack">${projectRows.map((item) => `<a class="card-link" href="/projects/${item.id}">${renderProjectCard(item, { selected: item.id === projectId })}</a>`).join("")}</div>`;
      } else {
        renderEmpty(listNode, "No projects yet", "Create projects once project authoring is exposed in the web shell or extension workflows.");
      }

      if (!projectId) {
        titleNode.textContent = "Projects";
        copyNode.textContent = "Open a project to see notes and documents already linked through canonical project relations.";
        renderHeroMeta();
        renderEmpty(notesNode, "Select a project", "Choose a project to load its notes.");
        renderEmpty(docsNode, "Select a project", "Choose a project to load its documents.");
        sourcesNode.innerHTML = `<div class="surface-note">Derived research visibility appears here once a project is selected. Projects do not directly own sources, citations, or quotes.</div>`;
        return;
      }

      const [project, notes, documents] = await Promise.all([
        apiFetchJson(`/api/projects/${projectId}`),
        apiFetchJson(`/api/notes?project_id=${encodeURIComponent(projectId)}&limit=6`),
        apiFetchJson(`/api/docs?project_id=${encodeURIComponent(projectId)}&limit=6`),
      ]);
      currentProject = project;

      titleNode.textContent = project.name || "Project";
      copyNode.textContent = project.description || "Organize notes and documents here while keeping research visibility derived.";
      renderHeroMeta();
      bindCreateControls();
      sourcesNode.innerHTML = `
        ${renderProjectDetail(project)}
        <section class="detail-section">
          <p class="section-kicker">Derived research</p>
          <div class="surface-note">Projects surface derived citations and sources through linked notes and documents only. Direct project editing for research relationships remains intentionally unavailable.</div>
        </section>
      `;

      noteRows = Array.isArray(notes?.data) ? notes.data : (Array.isArray(notes) ? notes : []);
      documentRows = Array.isArray(documents?.data) ? documents.data : (Array.isArray(documents) ? documents : []);

      if (noteRows.length) {
        notesNode.innerHTML = `<div class="card-stack">${noteRows.map((item) => `
          <article class="surface-card">
            ${renderNoteCard(item)}
            ${renderProjectAssignmentControl({ entityType: "note", entity: item, projects: projectRows })}
          </article>
        `).join("")}</div>`;
        bindMoveControls(notesNode);
      } else {
        renderEmpty(notesNode, "No notes in this project", "Create a note here or move an existing note into this project.");
      }

      if (documentRows.length) {
        docsNode.innerHTML = `<div class="card-stack">${documentRows.map((item) => `
          <article class="surface-card">
            ${renderDocumentCard(item)}
            ${renderProjectAssignmentControl({ entityType: "document", entity: item, projects: projectRows })}
          </article>
        `).join("")}</div>`;
        bindMoveControls(docsNode);
      } else {
        renderEmpty(docsNode, "No documents in this project", "Create a document here or move an existing document into this project.");
      }
    } catch (error) {
      [listNode, notesNode, docsNode].forEach((node) => {
        if (node) {
          renderError(node, error.message || "Failed to load projects.");
          bindRetry(node, load);
        }
      });
      heroMetaNode.innerHTML = `<div class="surface-note">Unable to load project workflows right now.</div>`;
      sourcesNode.innerHTML = `<div class="surface-note">Unable to resolve project details right now.</div>`;
    }
  }

  await load();
}
