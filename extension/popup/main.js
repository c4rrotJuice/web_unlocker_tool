import { createLogger } from "../shared/utils/logger.js";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.js";
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
    const title = document.createElement("h1");
    const status = document.createElement("p");
    const actions = document.createElement("div");
    title.textContent = "Writior";
    status.textContent = "Auth: loading";
    async function refreshAuth() {
        const result = await runtimeClient.authStatusGet();
        status.textContent = getAuthStatusText(result);
        return result;
    }
    actions.append(createButton("Sign in", async () => {
        status.textContent = "Auth: starting sign-in";
        const result = await runtimeClient.authStart({
            trigger: "popup_sign_in",
            redirectPath: "/dashboard",
        });
        status.textContent = getAuthStatusText(result);
    }), createButton("Sign out", async () => {
        const result = await runtimeClient.authLogout();
        status.textContent = getAuthStatusText(result);
    }), createButton("Open sidepanel", async () => {
        const result = await runtimeClient.openSidepanel();
        status.textContent = result.ok ? status.textContent : `Auth error: ${result.error.message}`;
    }));
    shell.append(title, status, actions);
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
