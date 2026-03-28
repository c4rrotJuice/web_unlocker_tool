import { createLogger } from "../shared/utils/logger.ts";
import { STORAGE_KEYS } from "../shared/constants/storage_keys.ts";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.ts";
import { renderPopupAuthSnapshot } from "./app/index.ts";

const logger = createLogger("popup");

function createButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function describeAuth(auth) {
  if (!auth) {
    return "Auth: unavailable";
  }
  if (auth.status === "loading") {
    return "Auth: loading";
  }
  if (auth.status === "refreshing") {
    return "Auth: refreshing";
  }
  if (auth.status === "signed_out") {
    return "Auth: signed out";
  }
  if (auth.status === "signed_in") {
    const name = auth.bootstrap?.profile?.display_name || auth.session?.email || "Signed in";
    return `Auth: ${name}`;
  }
  return `Auth error: ${auth.error?.message || "Unknown error"}`;
}

function getAuthStatusText(result) {
  const typedResult: any = result;
  return typedResult.ok ? describeAuth(typedResult.data?.auth) : `Auth error: ${typedResult.error.message}`;
}

function renderPopup(root) {
  const runtimeClient = createRuntimeClient(globalThis.chrome, SURFACE_NAMES.POPUP);
  const shell = document.createElement("section");
  const snapshotRoot = document.createElement("div");
  const actions = document.createElement("div");
  const signInButton = createButton("Sign in", async () => {
    renderPopupAuthSnapshot(snapshotRoot, { status: "loading" });
    const result: any = await runtimeClient.authStart({
      trigger: "popup_sign_in",
      redirectPath: "/dashboard",
    });
    renderPopupAuthSnapshot(snapshotRoot, result?.ok ? result.data?.auth : {
      status: "error",
      error: { message: getAuthStatusText(result) },
    });
  });
  const signOutButton = createButton("Sign out", async () => {
    const result: any = await runtimeClient.authLogout();
    renderPopupAuthSnapshot(snapshotRoot, result?.ok ? result.data?.auth : {
      status: "error",
      error: { message: getAuthStatusText(result) },
    });
  });

  function syncActionVisibility(auth) {
    const signedIn = auth?.status === "signed_in" || auth?.status === "refreshing";
    signInButton.style.display = signedIn ? "none" : "";
    signOutButton.style.display = signedIn ? "" : "none";
  }

  async function refreshAuth() {
    const result: any = await runtimeClient.authStatusGet();
    const auth = result?.ok ? result.data?.auth : {
      status: "error",
      error: { message: getAuthStatusText(result) },
    };
    syncActionVisibility(auth);
    renderPopupAuthSnapshot(snapshotRoot, auth);
    return result;
  }

  actions.append(
    signInButton,
    signOutButton,
    createButton("Open sidepanel", async () => {
      const result: any = await runtimeClient.openSidepanel();
      if (!result?.ok) {
        renderPopupAuthSnapshot(snapshotRoot, {
          status: "error",
          error: { message: result?.error?.message || "Open sidepanel failed." },
        });
      }
    }),
  );

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
