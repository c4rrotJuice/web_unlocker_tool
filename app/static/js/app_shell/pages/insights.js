import { apiFetchJson } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";

let booted = false;

function renderBars(rows, labelKey) {
  const max = Math.max(...rows.map((row) => row.count || 0), 1);
  return `<div class="bar-list">${rows.map((row) => `
    <div class="bar-row">
      <div>
        <div>${row[labelKey]}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(10, ((row.count || 0) / max) * 100)}%"></div></div>
      </div>
      <strong>${row.count || 0}</strong>
    </div>
  `).join("")}</div>`;
}

export async function initInsights() {
  if (booted) return;
  booted = true;

  const statsNode = document.getElementById("insights-stats");
  const domainsNode = document.getElementById("insights-domains");
  const stylesNode = document.getElementById("insights-citation-styles");
  const milestonesNode = document.getElementById("insights-milestones");

  renderLoading(statsNode, "Loading insight summary…");
  renderLoading(domainsNode, "Loading domains…");
  renderLoading(stylesNode, "Loading citation styles…");
  renderLoading(milestonesNode, "Loading milestones…");

  async function load() {
    try {
      const [summary, domains, styles] = await Promise.all([
        apiFetchJson("/api/insights/monthly-summary"),
        apiFetchJson("/api/insights/domains"),
        apiFetchJson("/api/insights/citation-styles"),
      ]);
      const momentum = summary.momentum || {};
      statsNode.innerHTML = [
        ["Streak", momentum.current_streak_days || 0],
        ["Active days", momentum.active_days_this_month || 0],
        ["Unlocks", momentum.unlocks_this_month || 0],
        ["Documents", momentum.documents_updated_this_month || 0],
      ].map(([label, value]) => `<article class="stat-card"><p class="section-kicker">${label}</p><strong>${value}</strong></article>`).join("");

      domainsNode.innerHTML = domains.length ? renderBars(domains.slice(0, 6), "domain") : `<div class="surface-note">No domain activity for this month.</div>`;
      stylesNode.innerHTML = styles.length ? renderBars(styles.slice(0, 6), "style") : `<div class="surface-note">No citation style activity for this month.</div>`;

      if ((summary.milestones || []).length) {
        milestonesNode.innerHTML = `<div class="milestone-stack">${summary.milestones.map((item) => `<article class="research-card"><h3 class="research-card-title">${item.label}</h3><p class="research-card-body">${item.achieved_at || "Recorded"}</p></article>`).join("")}</div>`;
      } else {
        renderEmpty(milestonesNode, "No milestones yet", "Milestones will appear here as momentum events accumulate.");
      }
    } catch (error) {
      [statsNode, domainsNode, stylesNode, milestonesNode].forEach((node) => {
        renderError(node, error.message || "Failed to load insights.");
        bindRetry(node, load);
      });
    }
  }

  await load();
}
