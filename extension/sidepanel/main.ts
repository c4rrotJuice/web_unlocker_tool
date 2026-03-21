import { MESSAGE_NAMES } from "../shared/constants/message_names.ts";
import { createSidepanelClient } from "./messaging/index.ts";
import { renderSidepanelShell } from "./app/index.ts";

async function bootstrap() {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  const client = createSidepanelClient(globalThis.chrome);
  const shell = renderSidepanelShell(root, {
    client,
    chromeApi: globalThis.chrome,
    documentRef: globalThis.document,
    navigatorRef: globalThis.navigator,
  });

  globalThis.chrome?.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type === MESSAGE_NAMES.SIDEPANEL_STATE_CHANGED || message?.type === MESSAGE_NAMES.CITATION_STATE_CHANGED) {
      void shell.refresh();
    }
  });
}

void bootstrap();
