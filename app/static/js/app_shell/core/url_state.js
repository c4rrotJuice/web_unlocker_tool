export function getResearchStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get("tab") || "sources",
    project: params.get("project") || "",
    tag: params.get("tag") || "",
    q: params.get("q") || "",
    selected: params.get("selected") || "",
  };
}

export function updateResearchUrl(nextState, { replace = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(nextState)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", nextUrl);
}
