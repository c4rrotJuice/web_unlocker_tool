import { createRuntimeClient, SURFACE_NAMES } from "../../shared/utils/runtime_client.ts";
import { getWritiorLogoAssetUrl } from "../../shared/constants/assets.ts";
import { createContentToastController } from "./toast.ts";

export function createSidepanelLauncher({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  chromeApi = globalThis.chrome,
  runtimeClient = createRuntimeClient(chromeApi, SURFACE_NAMES.CONTENT),
} = {}) {
  const toast = createContentToastController({ documentRef, windowRef });
  const host = documentRef.createElement("div");
  host.setAttribute("data-writior-launcher-host", "true");
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "24px";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "auto";

  const mount = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
  const style = documentRef.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .writior-launcher {
      all: initial;
      width: 38px;
      height: 38px;
      display: inline-grid;
      place-items: center;
      border-radius: 12px 0 0 12px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(2, 6, 23, 0.94);
      box-shadow: 0 12px 30px rgba(2, 6, 23, 0.28);
      cursor: pointer;
    }
    .writior-launcher[data-open="true"] {
      background: rgba(226, 232, 240, 0.96);
    }
    .writior-launcher img {
      width: 22px;
      height: 22px;
      display: block;
      object-fit: cover;
      border-radius: 7px;
    }
  `;
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "writior-launcher";
  button.setAttribute("data-open", "false");
  button.setAttribute("aria-label", "Toggle Writior sidepanel");
  button.setAttribute("aria-pressed", "false");

  const icon = documentRef.createElement("img");
  icon.alt = "Writior";
  icon.setAttribute("data-writior-launcher-icon", "true");
  icon.src = getWritiorLogoAssetUrl({ chromeApi, size: 32 });

  button.appendChild(icon);
  if (typeof mount.append === "function") {
    mount.append(style, button);
  } else {
    mount.appendChild(style);
    mount.appendChild(button);
  }

  let isOpen = false;
  let toggleInFlight: Promise<void> | null = null;

  async function toggle() {
    if (toggleInFlight) {
      return toggleInFlight;
    }
    toggleInFlight = (async () => {
      const result: any = await runtimeClient.openSidepanel({ mode: "toggle" });
      if (!result?.ok) {
        toast.show(result?.error?.message || "Workspace toggle failed.", { duration: 2200 });
        return;
      }
      toast.hide();
      isOpen = result.data?.opened === true;
      button.setAttribute("data-open", String(isOpen));
      button.setAttribute("aria-pressed", String(isOpen));
    })().finally(() => {
      toggleInFlight = null;
    });
    return toggleInFlight;
  }

  button.addEventListener("click", (event: any) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    void toggle();
  });

  return {
    host,
    mount() {
      const parent = documentRef.body || documentRef.documentElement;
      if (!parent || host.parentNode) {
        return;
      }
      parent.appendChild(host);
    },
    destroy() {
      toast.destroy();
      host.remove?.();
    },
    getState() {
      return { open: isOpen };
    },
  };
}
