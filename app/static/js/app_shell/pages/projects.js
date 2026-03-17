import { apiFetchJson } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";
import { renderDocumentCard, renderNoteCard, renderProjectCard } from "../renderers/cards.js";

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
  const projectId = boot.page_state?.project_id || null;

  renderLoading(listNode, "Loading projects…");
  if (projectId) {
    renderLoading(notesNode, "Loading project notes…");
    renderLoading(docsNode, "Loading project documents…");
  }

  async function load() {
    try {
      const projects = await apiFetchJson("/api/projects?include_archived=false&limit=24");
      if (projects.length) {
        listNode.innerHTML = `<div class="card-stack">${projects.map((item) => `<a class="card-link" href="/projects/${item.id}">${renderProjectCard(item, { selected: item.id === projectId })}</a>`).join("")}</div>`;
      } else {
        renderEmpty(listNode, "No projects yet", "Create projects once project authoring is exposed in the web shell or extension workflows.");
      }

      if (!projectId) {
        titleNode.textContent = "Projects";
        copyNode.textContent = "Open a project to see notes and documents already linked through canonical project relations.";
        renderEmpty(notesNode, "Select a project", "Choose a project to load its notes.");
        renderEmpty(docsNode, "Select a project", "Choose a project to load its documents.");
        sourcesNode.innerHTML = `<div class="surface-note">Project-scoped source listing remains limited until canonical source project filtering is exposed.</div>`;
        return;
      }

      const [project, notes, documents] = await Promise.all([
        apiFetchJson(`/api/projects/${projectId}`),
        apiFetchJson(`/api/notes?project_id=${encodeURIComponent(projectId)}&limit=6`),
        apiFetchJson(`/api/docs?project_id=${encodeURIComponent(projectId)}&limit=6`),
      ]);

      titleNode.textContent = project.name || "Project";
      copyNode.textContent = project.description || "Connected notes and documents for this project.";

      const noteRows = notes.data || [];
      const docRows = documents.data || [];

      if (noteRows.length) {
        notesNode.innerHTML = `<div class="card-stack">${noteRows.map((item) => renderNoteCard(item)).join("")}</div>`;
      } else {
        renderEmpty(notesNode, "No notes in this project", "Project notes will appear here once they are linked canonically.");
      }

      if (docRows.length) {
        docsNode.innerHTML = `<div class="card-stack">${docRows.map((item) => renderDocumentCard(item)).join("")}</div>`;
      } else {
        renderEmpty(docsNode, "No documents in this project", "Project documents will appear here once they are linked canonically.");
      }

      sourcesNode.innerHTML = `<div class="surface-note">Project-scoped source listing is intentionally limited in Phase 7. The shell will not overfetch broad source collections to simulate missing canonical filters.</div>`;
    } catch (error) {
      [listNode, notesNode, docsNode].forEach((node) => {
        if (node) {
          renderError(node, error.message || "Failed to load projects.");
          bindRetry(node, load);
        }
      });
      sourcesNode.innerHTML = `<div class="surface-note">Unable to resolve project details right now.</div>`;
    }
  }

  await load();
}
