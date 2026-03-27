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
  const meta = [
    preview.project ? `Project: ${preview.project}` : "",
    preview.updated ? `Updated: ${preview.updated}` : "",
    preview.citations !== undefined ? `Citations: ${preview.citations}` : "",
    preview.notes !== undefined ? `Notes: ${preview.notes}` : "",
    preview.source ? `Source: ${preview.source}` : "",
    preview.year ? `Year: ${preview.year}` : "",
  ].filter(Boolean);
  return `
    <h4>${escapeHtml(preview.title || "Details")}</h4>
    ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
    ${meta.length ? `<ul>${meta.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
  `;
}

export function bindExplorerPreview({ list, panel }) {
  let hideTimer = null;
  let activeRow = null;

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
      activeRow = null;
      return;
    }
    clearHideTimer();
    activeRow = row;
    panel.innerHTML = renderPreview(preview);
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const top = Math.max(0, Math.min(row.offsetTop - list.scrollTop, list.clientHeight - 180));
    panel.style.top = `${top}px`;
    panel.dataset.previewType = preview.type || "";
    if (rowRect.right > window.innerWidth - 280 || listRect.right > window.innerWidth - 280) {
      panel.style.left = "auto";
      panel.style.right = "0";
    } else {
      panel.style.left = "calc(100% + 0.5rem)";
      panel.style.right = "auto";
    }
    panel.hidden = false;
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      panel.hidden = true;
      panel.innerHTML = "";
      activeRow = null;
    }, 140);
  }

  const onOver = (event) => {
    const row = event.target.closest(".editor-v2-row");
    if (!row || !list.contains(row)) return;
    showForRow(row);
  };
  const onOut = (event) => {
    const next = event.relatedTarget;
    if (next && (list.contains(next) || panel.contains(next))) return;
    scheduleHide();
  };
  const onFocus = (event) => {
    const row = event.target.closest(".editor-v2-row");
    if (!row || !list.contains(row)) return;
    showForRow(row);
  };
  const onBlur = (event) => {
    const next = event.relatedTarget;
    if (next && (list.contains(next) || panel.contains(next))) return;
    scheduleHide();
  };
  const onPanelEnter = () => clearHideTimer();
  const onPanelLeave = (event) => {
    const next = event.relatedTarget;
    if (next && (panel.contains(next) || list.contains(next))) return;
    scheduleHide();
  };
  const onListScroll = () => {
    if (activeRow && !panel.hidden) {
      showForRow(activeRow);
    }
  };

  list.addEventListener("mouseover", onOver);
  list.addEventListener("mouseout", onOut);
  list.addEventListener("focusin", onFocus);
  list.addEventListener("focusout", onBlur);
  list.addEventListener("scroll", onListScroll);
  panel.addEventListener("mouseenter", onPanelEnter);
  panel.addEventListener("mouseleave", onPanelLeave);
  panel.addEventListener("focusin", onPanelEnter);
  panel.addEventListener("focusout", onPanelLeave);

  return () => {
    clearHideTimer();
    list.removeEventListener("mouseover", onOver);
    list.removeEventListener("mouseout", onOut);
    list.removeEventListener("focusin", onFocus);
    list.removeEventListener("focusout", onBlur);
    list.removeEventListener("scroll", onListScroll);
    panel.removeEventListener("mouseenter", onPanelEnter);
    panel.removeEventListener("mouseleave", onPanelLeave);
    panel.removeEventListener("focusin", onPanelEnter);
    panel.removeEventListener("focusout", onPanelLeave);
  };
}
