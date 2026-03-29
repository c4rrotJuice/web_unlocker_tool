import { escapeHtml } from "../core/format.js";

function projectSelectOptions(projects = [], currentProjectId = "") {
  const rows = [{ id: "", name: "No project" }, ...projects];
  return rows.map((project) => {
    const id = String(project?.id || "");
    const name = project?.name || "Untitled project";
    const selected = id === String(currentProjectId || "");
    return `<option value="${escapeHtml(id)}"${selected ? " selected" : ""}>${escapeHtml(name)}</option>`;
  }).join("");
}

export function renderProjectAssignmentControl({ entityType, entity, projects = [] }) {
  const entityId = String(entity?.id || "");
  const currentProjectId = String(entity?.project_id || "");
  const currentProjectName = entity?.project?.name || "No project";
  const controlId = `${entityType}:${entityId}`;
  return `
    <section class="detail-section">
      <p class="section-kicker">Organization</p>
      <p class="surface-note">Projects organize notes and documents only. This does not create research relationships.</p>
      <div class="detail-chip-row">
        <span class="meta-pill">Current: ${escapeHtml(currentProjectName)}</span>
      </div>
      <div class="detail-chip-row">
        <label>
          <span class="surface-note">Project</span>
          <select
            data-project-assignment-select="${escapeHtml(controlId)}"
            data-current-project-id="${escapeHtml(currentProjectId)}"
          >${projectSelectOptions(projects, currentProjectId)}</select>
        </label>
        <button
          type="button"
          class="app-button-secondary"
          data-project-assignment-save="${escapeHtml(controlId)}"
          data-entity-type="${escapeHtml(entityType)}"
          data-entity-id="${escapeHtml(entityId)}"
        >Move ${escapeHtml(entityType)}</button>
      </div>
    </section>
  `;
}
