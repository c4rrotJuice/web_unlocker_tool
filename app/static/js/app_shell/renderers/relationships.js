import { escapeHtml } from "../core/format.js";

export const EVIDENCE_ROLE_ORDER = Object.freeze(["primary", "supporting", "background"]);
export const EVIDENCE_ROLE_LABELS = Object.freeze({
  primary: "Primary evidence",
  supporting: "Supporting evidence",
  background: "Background reading",
});

export const NOTE_LINK_TYPE_ORDER = Object.freeze(["supports", "contradicts", "extends", "related"]);
export const NOTE_LINK_TYPE_LABELS = Object.freeze({
  supports: "Supports",
  contradicts: "Contradicts",
  extends: "Extends",
  related: "Related",
});

function normalizeGroups(groups) {
  return groups && typeof groups === "object" ? groups : null;
}

export function relationshipCount(value, fallback = 0) {
  const count = Number(value);
  return Number.isFinite(count) ? count : fallback;
}

export function renderMetaCount(label, count, { compact = false } = {}) {
  const value = relationshipCount(count, 0);
  const suffix = compact ? label : `${value} ${label}`;
  return `<span class="meta-pill">${escapeHtml(compact ? String(value) : suffix)}</span>`;
}

export function renderGroupedRelationshipSection({
  title,
  groups,
  order,
  labels,
  renderItem,
  emptyLabel,
  unsupported = false,
}) {
  if (unsupported) return "";
  const normalizedGroups = normalizeGroups(groups);
  if (!normalizedGroups) return "";
  const hasItems = order.some((key) => Array.isArray(normalizedGroups[key]) && normalizedGroups[key].length);
  return `
    <section class="detail-section">
      <p class="section-kicker">${escapeHtml(title)}</p>
      ${hasItems
        ? `<div class="relationship-group-stack">
          ${order
            .filter((key) => Array.isArray(normalizedGroups[key]))
            .map((key) => {
              const rows = normalizedGroups[key] || [];
              return `
                <article class="relationship-group">
                  <h4 class="relationship-group-title">${escapeHtml(labels[key] || key)}</h4>
                  ${rows.length
                    ? `<div class="detail-list">${rows.map((row) => `<div class="detail-list-item">${renderItem(row, key)}</div>`).join("")}</div>`
                    : `<div class="surface-note">${escapeHtml(`No ${String(labels[key] || key).toLowerCase()} yet.`)}</div>`}
                </article>
              `;
            }).join("")}
        </div>`
        : `<div class="surface-note">${escapeHtml(emptyLabel)}</div>`}
    </section>
  `;
}

export function renderRelationshipSummary(items) {
  const visibleItems = (items || []).filter((item) => item && item.visible !== false);
  if (!visibleItems.length) return "";
  return `
    <section class="detail-section">
      <p class="section-kicker">Relationship context</p>
      <div class="detail-summary-grid">
        ${visibleItems.map((item) => `
          <article class="detail-summary-card">
            <span class="detail-summary-count">${escapeHtml(String(relationshipCount(item.count, 0)))}</span>
            <span class="detail-summary-label">${escapeHtml(item.label)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

