import { escapeHtml } from "../../app_shell/core/format.js";

export function renderCommandMenu(target, commands, filter = "") {
  target.hidden = false;
  target.innerHTML = `
    <label class="editor-v2-meta" for="editor-command-filter">Command</label>
    <input id="editor-command-filter" type="text" value="${escapeHtml(filter)}" placeholder="Search commands" />
    <div class="editor-v2-command-results">
      ${commands.map((command) => `
        <button class="editor-v2-card" type="button" data-command-id="${escapeHtml(command.id)}">
          <strong>${escapeHtml(command.label)}</strong>
          <div class="editor-v2-meta">${escapeHtml(command.group)}</div>
        </button>
      `).join("")}
    </div>
  `;
}

export function hidePopover(target) {
  target.hidden = true;
  target.innerHTML = "";
}
