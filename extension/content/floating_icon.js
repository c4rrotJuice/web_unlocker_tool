import { MESSAGE_TYPES } from "../shared/messages.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";

export function createFloatingIcon({ overlay }) {
  let icon = null;

  function destroy() {
    icon?.remove();
    icon = null;
  }

  function ensure() {
    if (icon) return icon;
    icon = document.createElement("button");
    icon.type = "button";
    icon.className = "writior-floating-icon";
    icon.setAttribute("aria-label", "Open Writior sidepanel");
    icon.innerHTML = '<span aria-hidden="true">W</span>';
    icon.addEventListener("click", () => {
      void sendRuntimeMessage(MESSAGE_TYPES.OPEN_SIDEPANEL, {});
    });
    overlay.root.appendChild(icon);
    return icon;
  }

  return {
    setVisible(visible) {
      if (!visible) {
        destroy();
        return;
      }
      ensure();
    },
    destroy,
  };
}
