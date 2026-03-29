import { createLogger } from "../shared/utils/logger.ts";
import { STORAGE_KEYS } from "../shared/constants/storage_keys.ts";
import { shouldPresentSignedInUi } from "../shared/types/auth.ts";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.ts";
import { renderPopupAuthSnapshot } from "./app/index.ts";

const logger = createLogger("popup");

function createButton(label, onClick, tone = "default") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.minHeight = "34px";
  button.style.padding = "0 12px";
  button.style.borderRadius = "10px";
  button.style.border = tone === "primary"
    ? "1px solid rgba(248, 250, 252, 0.26)"
    : "1px solid rgba(148, 163, 184, 0.18)";
  button.style.background = tone === "primary" ? "#e2e8f0" : "rgba(15, 23, 42, 0.72)";
  button.style.color = tone === "primary" ? "#0f172a" : "#e2e8f0";
  button.style.fontSize = "12px";
  button.style.fontWeight = "600";
  button.addEventListener("click", onClick);
  return button;
}

function getAuthStatusText(result) {
  const typedResult: any = result;
  return typedResult.ok ? typedResult.data?.auth : { status: "error", error: { message: typedResult?.error?.message || "Auth error" } };
}

function renderPopup(root) {
  const runtimeClient = createRuntimeClient(globalThis.chrome, SURFACE_NAMES.POPUP);
  const shell = document.createElement("section");
  shell.style.display = "grid";
  shell.style.gap = "10px";
  shell.style.padding = "12px";
  shell.style.minWidth = "220px";
  shell.style.background = "linear-gradient(180deg, #020617 0%, #0f172a 100%)";
  shell.style.color = "#e2e8f0";
  shell.style.fontFamily = "\"Segoe UI\", Arial, sans-serif";

  const snapshotRoot = document.createElement("div");
  snapshotRoot.style.padding = "12px";
  snapshotRoot.style.border = "1px solid rgba(148, 163, 184, 0.14)";
  snapshotRoot.style.borderRadius = "14px";
  snapshotRoot.style.background = "rgba(15, 23, 42, 0.82)";

  const actions = document.createElement("div");
  actions.style.display = "grid";
  actions.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  actions.style.gap = "8px";

  const signInButton = createButton("Sign In", async () => {
    renderPopupAuthSnapshot(snapshotRoot, { status: "loading" });
    const result: any = await runtimeClient.authStart({
      trigger: "popup_sign_in",
      redirectPath: "/dashboard",
    });
    renderPopupAuthSnapshot(snapshotRoot, getAuthStatusText(result));
  }, "primary");
  const signOutButton = createButton("Sign Out", async () => {
    const result: any = await runtimeClient.authLogout();
    renderPopupAuthSnapshot(snapshotRoot, getAuthStatusText(result));
  });
  const openSidepanelButton = createButton("Toggle Workspace", async () => {
    const result: any = await runtimeClient.openSidepanel({ mode: "toggle" });
    if (!result?.ok) {
      renderPopupAuthSnapshot(snapshotRoot, {
        status: "error",
        error: { message: result?.error?.message || "Open workspace failed." },
      });
      return;
    }
    globalThis.window?.close?.();
  });
  openSidepanelButton.style.gridColumn = "1 / -1";

  function syncActionVisibility(auth) {
    const signedIn = shouldPresentSignedInUi(auth);
    signInButton.style.display = signedIn ? "none" : "";
    signOutButton.style.display = signedIn ? "" : "none";
  }

  async function refreshAuth() {
    const result: any = await runtimeClient.authStatusGet();
    const auth = getAuthStatusText(result);
    syncActionVisibility(auth);
    renderPopupAuthSnapshot(snapshotRoot, auth);
  }

  actions.append(signInButton, signOutButton, openSidepanelButton);
  renderPopupAuthSnapshot(snapshotRoot, { status: "loading" });
  syncActionVisibility({ status: "loading" });
  shell.append(snapshotRoot, actions);
  root.replaceChildren(shell);

  globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes?.[STORAGE_KEYS.AUTH_STATE]) {
      return;
    }
    const auth = changes[STORAGE_KEYS.AUTH_STATE].newValue || { status: "signed_out" };
    syncActionVisibility(auth);
    renderPopupAuthSnapshot(snapshotRoot, auth);
  });
  void refreshAuth();
}

export function bootstrapPopup() {
  logger.info("popup loaded");
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  renderPopup(root);
}

if (typeof globalThis.document !== "undefined") {
  bootstrapPopup();
}
