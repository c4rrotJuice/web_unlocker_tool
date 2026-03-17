import { overlayCss } from "../styles/overlay.css.js";

const ROOT_ID = "writior-root";
const OWNER_ATTR = "data-writior-overlay-root";
const HOST_ATTR = "data-writior-overlay-host";

function findOwnedHost() {
  return document.querySelector(`[${OWNER_ATTR}="true"]`);
}

function createOwnedHostId() {
  const token = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
  return `${ROOT_ID}-${token}`;
}

export function createOverlayRoot() {
  let host = findOwnedHost();
  if (!host) {
    const existing = document.getElementById(ROOT_ID);
    const safeId = existing && existing.getAttribute(OWNER_ATTR) !== "true" ? createOwnedHostId() : ROOT_ID;
    host = document.createElement("div");
    host.id = safeId;
    host.setAttribute(OWNER_ATTR, "true");
    host.setAttribute(HOST_ATTR, safeId);
    (document.documentElement || document.body).appendChild(host);
  }
  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = overlayCss;
  const root = document.createElement("div");
  root.className = "writior-overlay-root";
  shadow.append(style, root);
  return {
    host,
    shadow,
    root,
    clear() {
      root.innerHTML = "";
    },
    destroy() {
      host.remove();
    },
  };
}
