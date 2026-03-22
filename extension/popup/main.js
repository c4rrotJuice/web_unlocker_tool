import { createLogger } from "../shared/utils/logger.js";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.js";
import { renderPopupAuthSnapshot } from "./app/index.js";
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
    const typedResult = result;
    return typedResult.ok ? describeAuth(typedResult.data?.auth) : `Auth error: ${typedResult.error.message}`;
}
function renderPopup(root) {
    const runtimeClient = createRuntimeClient(globalThis.chrome, SURFACE_NAMES.POPUP);
    const shell = document.createElement("section");
    const snapshotRoot = document.createElement("div");
    const actions = document.createElement("div");
    async function refreshAuth() {
        const result = await runtimeClient.authStatusGet();
        renderPopupAuthSnapshot(snapshotRoot, result?.ok ? result.data?.auth : {
            status: "error",
            error: { message: getAuthStatusText(result) },
        });
        return result;
    }
    actions.append(createButton("Sign in", async () => {
        renderPopupAuthSnapshot(snapshotRoot, { status: "loading" });
        const result = await runtimeClient.authStart({
            trigger: "popup_sign_in",
            redirectPath: "/dashboard",
        });
        renderPopupAuthSnapshot(snapshotRoot, result?.ok ? result.data?.auth : {
            status: "error",
            error: { message: getAuthStatusText(result) },
        });
    }), createButton("Sign out", async () => {
        const result = await runtimeClient.authLogout();
        renderPopupAuthSnapshot(snapshotRoot, result?.ok ? result.data?.auth : {
            status: "error",
            error: { message: getAuthStatusText(result) },
        });
    }), createButton("Open sidepanel", async () => {
        const result = await runtimeClient.openSidepanel();
        if (!result?.ok) {
            renderPopupAuthSnapshot(snapshotRoot, {
                status: "error",
                error: { message: result?.error?.message || "Open sidepanel failed." },
            });
        }
    }));
    renderPopupAuthSnapshot(snapshotRoot, { status: "loading" });
    shell.append(snapshotRoot, actions);
    root.replaceChildren(shell);
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
