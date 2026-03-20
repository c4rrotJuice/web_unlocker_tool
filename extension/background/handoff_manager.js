import { BACKEND_BASE_URL } from "../config.js";
import { createLogger } from "../shared/log.js";

const logger = createLogger("background:handoff");

export function createHandoffManager({ apiClient, sessionManager }) {
  return {
    async restoreAuthSession({ code }) {
      const exchange = await apiClient.exchangeHandoff({ code });
      const payload = exchange?.data || exchange || {};
      const session = payload.session;
      if (!session) {
        throw new Error("handoff_session_missing");
      }
      const publicSession = await sessionManager.restoreSession(session);
      return {
        ok: true,
        data: {
          session: publicSession,
          web_session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          },
          redirect_path: payload.redirect_path || "/dashboard",
        },
      };
    },
    async openAppSignIn() {
      await chrome.tabs.create({ url: `${BACKEND_BASE_URL}/auth?source=extension` });
      return { ok: true };
    },
    async workInEditor(payload) {
      const response = await apiClient.workInEditor(payload, { idempotencyKey: payload.idempotency_key });
      const session = await sessionManager.ensureSession({ allowMissing: false });
      const handoff = await apiClient.issueHandoff({
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
        redirect_path: response?.data?.redirect_path || response?.redirect_path || "/editor",
      });
      const code = handoff?.data?.code || handoff?.code;
      if (!code) {
        throw new Error("handoff_code_missing");
      }
      const handoffUrl = `${BACKEND_BASE_URL}/auth/handoff?code=${encodeURIComponent(code)}`;
      logger.info("Opening work-in-editor handoff", { redirect_path: response?.data?.redirect_path || response?.redirect_path });
      await chrome.tabs.create({ url: handoffUrl });
      return response;
    },
  };
}
