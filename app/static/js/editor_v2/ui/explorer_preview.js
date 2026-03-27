import { escapeHtml } from "../../app_shell/core/format.js";

function parsePreview(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function renderPreview(preview) {
  if (!preview) {
    return "";
  }
  const detail = preview.detail || preview.updated || preview.source || "";
  return `
    <h4>${escapeHtml(preview.title || "Details")}</h4>
    ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    <ul>
      ${preview.project ? `<li>Project: ${escapeHtml(preview.project)}</li>` : ""}
      ${preview.updated ? `<li>Updated: ${escapeHtml(preview.updated)}</li>` : ""}
      ${preview.citations !== undefined ? `<li>Citations: ${escapeHtml(String(preview.citations))}</li>` : ""}
      ${preview.notes !== undefined ? `<li>Notes: ${escapeHtml(String(preview.notes))}</li>` : ""}
      ${preview.source ? `<li>Source: ${escapeHtml(preview.source)}</li>` : ""}
      ${preview.year ? `<li>Year: ${escapeHtml(String(preview.year))}</li>` : ""}
    </ul>
  `;
}

export function bindExplorerPreview({ list, panel }) {
  let hideTimer = null;

  function clearHideTimer() {
    if (!hideTimer) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function showForRow(row) {
    const preview = parsePreview(row?.dataset?.preview || "");
    if (!preview) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    clearHideTimer();
    panel.innerHTML = renderPreview(preview);
    panel.hidden = false;
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      panel.hidden = true;
      panel.innerHTML = "";
    }, 140);
  }

  const onOver = (event) => {
    const row = event.target.closest(".editor-v2-row");
    if (!row || !list.contains(row)) return;
    showForRow(row);
  };
  const onOut = (event) => {
    const next = event.relatedTarget;
    if (next && list.contains(next)) return;
    scheduleHide();
  };
  const onFocus = (event) => {
    const row = event.target.closest(".editor-v2-row");
    if (!row || !list.contains(row)) return;
    showForRow(row);
  };
  const onBlur = (event) => {
    const next = event.relatedTarget;
    if (next && list.contains(next)) return;
    scheduleHide();
  };

  list.addEventListener("mouseover", onOver);
  list.addEventListener("mouseout", onOut);
  list.addEventListener("focusin", onFocus);
  list.addEventListener("focusout", onBlur);

  return () => {
    clearHideTimer();
    list.removeEventListener("mouseover", onOver);
    list.removeEventListener("mouseout", onOut);
    list.removeEventListener("focusin", onFocus);
    list.removeEventListener("focusout", onBlur);
  };
}
