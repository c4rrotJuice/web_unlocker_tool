import { MESSAGE_NAMES } from "../shared/constants/message_names.ts";
import { ERROR_CODES } from "../shared/types/messages.ts";
import { sendRuntimeMessage } from "../shared/utils/runtime_message.ts";
import { renderPopupAuthSnapshot } from "./app/index.ts";

async function bootstrap() {
  const root = document.getElementById("app");
  renderPopupAuthSnapshot(root, { status: "loading" });
  const response = await sendRuntimeMessage(globalThis.chrome, { type: MESSAGE_NAMES.AUTH_GET_STATE });
  if (!response || response.ok === false) {
    renderPopupAuthSnapshot(root, {
      status: "error",
      error: response?.error || { code: ERROR_CODES.AUTH_INVALID, message: "Failed to load auth state." },
    });
    return;
  }
  renderPopupAuthSnapshot(root, response?.data?.auth || { status: "signed_out" });
}

void bootstrap();
