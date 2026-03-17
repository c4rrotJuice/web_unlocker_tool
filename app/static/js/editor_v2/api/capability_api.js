import { apiFetchJson } from "../../app_shell/core/fetch.js";

export async function getEditorAccess() {
  return apiFetchJson("/api/editor/access");
}
