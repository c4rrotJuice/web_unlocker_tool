import { API_ORIGIN } from "../../shared/constants/endpoints.ts";
import { ERROR_CODES, createErrorResult, createOkResult } from "../../shared/types/messages.ts";

function getAppOrigin(stateStore) {
  const bootstrapOrigin = stateStore?.getState?.()?.bootstrap?.app?.origin;
  return typeof bootstrapOrigin === "string" && bootstrapOrigin.trim() ? bootstrapOrigin.trim() : API_ORIGIN;
}

function resolveAppUrl(stateStore, path) {
  return new URL(path, getAppOrigin(stateStore)).toString();
}

export function createSurfaceHandler({ chromeApi, stateStore, authHandler, apiClient } = {}) {
  if (!chromeApi) {
    throw new Error("createSurfaceHandler requires a chromeApi.");
  }
  if (!stateStore) {
    throw new Error("createSurfaceHandler requires a stateStore.");
  }
  if (!authHandler) {
    throw new Error("createSurfaceHandler requires an authHandler.");
  }
  if (!apiClient) {
    throw new Error("createSurfaceHandler requires an apiClient.");
  }

  async function listCitations({ limit = 8, offset = 0, query = "" } = {}) {
    return apiClient.listCitations({ limit, offset, query });
  }

  async function listNotes({ limit = 8, offset = 0, query = "" } = {}) {
    return apiClient.listNotes({ limit, offset, query });
  }

  async function openEditor() {
    const url = resolveAppUrl(stateStore, "/editor");
    if (!chromeApi.tabs?.create) {
      return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "Tab creation is unavailable.");
    }
    await chromeApi.tabs.create({ url, active: true });
    return createOkResult({ destination: "editor", url });
  }

  async function openDashboard() {
    const url = resolveAppUrl(stateStore, "/dashboard");
    if (!chromeApi.tabs?.create) {
      return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "Tab creation is unavailable.");
    }
    await chromeApi.tabs.create({ url, active: true });
    return createOkResult({ destination: "dashboard", url });
  }

  async function signOut() {
    return authHandler.signOut("sidepanel_sign_out");
  }

  return {
    listCitations,
    listNotes,
    openEditor,
    openDashboard,
    signOut,
  };
}
