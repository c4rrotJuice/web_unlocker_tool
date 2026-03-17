import { apiFetchJson } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";
import { renderDocumentCard, renderSourceCard } from "../renderers/cards.js";

let booted = false;

export async function initDashboard() {
  if (booted) return;
  booted = true;

  const stats = document.getElementById("dashboard-stats");
  const recentResearch = document.getElementById("dashboard-recent-research");
  const recentDocuments = document.getElementById("dashboard-recent-documents");
  const milestones = document.getElementById("dashboard-milestones");
  const greeting = document.getElementById("dashboard-greeting");
  const greetingMeta = document.getElementById("dashboard-greeting-meta");

  renderLoading(stats, "Loading dashboard summary…");
  renderLoading(recentResearch, "Loading recent research…");
  renderLoading(recentDocuments, "Loading recent documents…");
  renderLoading(milestones, "Loading milestones…");

  async function load() {
    try {
      const [me, summary, sources, documents] = await Promise.all([
        apiFetchJson("/api/me"),
        apiFetchJson("/api/insights/monthly-summary"),
        apiFetchJson("/api/sources?limit=4"),
        apiFetchJson("/api/docs?limit=4"),
      ]);

      const user = me.user || {};
      const entitlement = me.entitlement || {};
      const momentum = summary.momentum || {};

      greeting.querySelector(".hero-title").textContent = `Welcome back, ${user.display_name || "User"}`;
      greeting.querySelector(".hero-copy").textContent = "Capture evidence, connect it to notes, and continue writing without loading the full editor.";
      greetingMeta.innerHTML = `
        <span class="meta-pill">${entitlement.tier || "free"} plan</span>
        <span class="meta-pill">${momentum.current_streak_days || 0} day streak</span>
      `;

      stats.innerHTML = [
        ["Unlocks", momentum.unlocks_this_month || 0],
        ["Captures", momentum.captures_this_month || 0],
        ["Copy assists", momentum.copy_assists_this_month || 0],
        ["Documents updated", momentum.documents_updated_this_month || 0],
      ].map(([label, value]) => `<article class="stat-card"><p class="section-kicker">${label}</p><strong>${value}</strong></article>`).join("");

      if (Array.isArray(sources) && sources.length) {
        recentResearch.innerHTML = `<div class="card-stack">${sources.map((item) => renderSourceCard(item)).join("")}</div>`;
      } else {
        renderEmpty(recentResearch, "No sources yet", "Capture a source from the extension to start the research graph.");
      }

      const docs = documents.data || [];
      if (docs.length) {
        recentDocuments.innerHTML = `<div class="card-stack">${docs.map((item) => renderDocumentCard(item)).join("")}</div>`;
      } else {
        renderEmpty(recentDocuments, "No documents yet", "Open the editor to create your first document.");
      }

      if ((summary.milestones || []).length) {
        milestones.innerHTML = `<div class="milestone-stack">${summary.milestones.map((item) => `<article class="research-card"><h3 class="research-card-title">${item.label}</h3><p class="research-card-body">${item.achieved_at || "Recorded this month"}</p></article>`).join("")}</div>`;
      } else {
        renderEmpty(milestones, "No milestones this month", "Activity milestones will appear here as your research cadence grows.");
      }
    } catch (error) {
      renderError(stats, error.message || "Failed to load dashboard.");
      renderError(recentResearch, error.message || "Failed to load recent research.");
      renderError(recentDocuments, error.message || "Failed to load recent documents.");
      renderError(milestones, error.message || "Failed to load milestones.");
      [stats, recentResearch, recentDocuments, milestones].forEach((node) => bindRetry(node, load));
    }
  }

  await load();
}
