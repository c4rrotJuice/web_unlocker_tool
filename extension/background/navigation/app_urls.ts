import { API_ORIGIN } from "../../shared/constants/endpoints.ts";

const CANONICAL_APP_ROUTES = Object.freeze({
  dashboard: "/dashboard",
  editor: "/editor",
});

function readBootstrapApp(stateStore) {
  const app = stateStore?.getState?.()?.bootstrap?.app;
  return app && typeof app === "object" ? app : null;
}

export function getAppOrigin(stateStore) {
  const origin = readBootstrapApp(stateStore)?.origin;
  return typeof origin === "string" && origin.trim() ? origin.trim() : API_ORIGIN;
}

export function resolveCanonicalUrl(urlOrPath, stateStore) {
  if (typeof urlOrPath !== "string" || !urlOrPath.trim()) {
    return "";
  }
  try {
    const appOrigin = getAppOrigin(stateStore);
    const resolved = new URL(urlOrPath.trim(), appOrigin);
    if (resolved.origin !== new URL(appOrigin).origin) {
      return "";
    }
    return resolved.toString();
  } catch {
    return "";
  }
}

function readCandidate(app, candidates = []) {
  for (const candidate of candidates) {
    const value = candidate.split(".").reduce((current, key) => current?.[key], app);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function resolveCanonicalDestinationUrl(stateStore, destination) {
  const app = readBootstrapApp(stateStore);
  const fallbackRoute = CANONICAL_APP_ROUTES[destination] || "";

  if (destination === "editor") {
    return resolveCanonicalUrl(
      readCandidate(app, [
        "handoff.preferred_destination",
        "routes.editor_url",
        "routes.editor_path",
        "editor_url",
        "editor_path",
      ]) || fallbackRoute,
      stateStore,
    );
  }

  if (destination === "dashboard") {
    return resolveCanonicalUrl(
      readCandidate(app, [
        "routes.dashboard_url",
        "routes.dashboard_path",
        "dashboard_url",
        "dashboard_path",
      ]) || fallbackRoute,
      stateStore,
    );
  }

  return "";
}
