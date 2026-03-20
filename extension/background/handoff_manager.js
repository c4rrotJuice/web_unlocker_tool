import { BACKEND_BASE_URL } from "../config.js";
import { createLogger } from "../shared/log.js";

const logger = createLogger("background:handoff");
const AUTH_ATTEMPT_STORAGE_KEY = "auth_pending_attempt";
const POLL_TIMEOUT_MS = 75_000;
const POLL_DELAYS_MS = [500, 900, 1400, 2000, 2800, 3800, 5000, 6500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readAttemptPayload(payload) {
  const data = payload?.data || payload || {};
  return {
    attemptId: data.attempt_id || data.attemptId || null,
    attemptToken: data.attempt_token || data.attemptToken || null,
    expiresAt: data.expires_at || null,
    redirectPath: data.redirect_path || "/dashboard",
  };
}

export function createHandoffManager({ apiClient, sessionManager }) {
  async function clearPendingAttempt() {
    await chrome.storage.local.remove([AUTH_ATTEMPT_STORAGE_KEY]);
  }

  async function writePendingAttempt(attempt) {
    await chrome.storage.local.set({
      [AUTH_ATTEMPT_STORAGE_KEY]: {
        ...attempt,
        created_at: new Date().toISOString(),
      },
    });
  }

  async function readPendingAttempt() {
    const payload = await chrome.storage.local.get({ [AUTH_ATTEMPT_STORAGE_KEY]: null });
    return payload[AUTH_ATTEMPT_STORAGE_KEY] || null;
  }

  async function pollAttemptUntilReady({ attemptId, attemptToken, timeoutMs = POLL_TIMEOUT_MS }) {
    const startedAt = Date.now();
    let pollCount = 0;
    logger.info("Auth attempt polling started", { attempt_id: attemptId, timeout_ms: timeoutMs });
    try {
      while (Date.now() - startedAt <= timeoutMs) {
        pollCount += 1;
        try {
          const statusResponse = await apiClient.getAuthAttemptStatus({ attemptId, attemptToken });
          const payload = statusResponse?.data || statusResponse || {};
          const status = payload.status || "pending";
          if (status === "ready" && payload?.exchange?.code) {
            logger.info("Auth attempt ready", { attempt_id: attemptId, poll_count: pollCount });
            return payload;
          }
          if (status === "expired") {
            throw new Error("auth_attempt_expired");
          }
        } catch (error) {
          const code = error?.payload?.error?.code || error?.payload?.detail?.code || error?.message;
          if (code === "auth_attempt_expired" || code === "handoff_expired") {
            throw new Error("auth_attempt_expired");
          }
          if (code === "auth_attempt_invalid") {
            throw new Error("auth_attempt_invalid");
          }
        }
        const delay = POLL_DELAYS_MS[Math.min(pollCount - 1, POLL_DELAYS_MS.length - 1)];
        await sleep(delay);
      }
      throw new Error("auth_attempt_timeout");
    } finally {
      logger.info("Auth attempt polling stopped", { attempt_id: attemptId, poll_count: pollCount, elapsed_ms: Date.now() - startedAt });
    }
  }

  async function restoreFromAttempt({ attemptId, attemptToken }) {
    const readyPayload = await pollAttemptUntilReady({ attemptId, attemptToken });
    const exchangeCode = readyPayload?.exchange?.code;
    if (!exchangeCode) {
      throw new Error("handoff_code_missing");
    }
    const exchange = await apiClient.exchangeHandoff({ code: exchangeCode });
    const payload = exchange?.data || exchange || {};
    const session = payload.session;
    if (!session) {
      throw new Error("handoff_session_missing");
    }
    const publicSession = await sessionManager.restoreSession(session);
    await sessionManager.broadcastAuthHydration({ source: "attempt_polling", attempt_id: attemptId });
    logger.info("Auth exchange success", { attempt_id: attemptId });
    await clearPendingAttempt();
    return {
      ok: true,
      data: {
        session: publicSession,
        redirect_path: payload.redirect_path || readyPayload?.redirect_path || "/dashboard",
        attempt_id: attemptId,
      },
    };
  }

  return {
    async restoreAuthSession({ code }) {
      const exchange = await apiClient.exchangeHandoff({ code });
      const payload = exchange?.data || exchange || {};
      const session = payload.session;
      if (!session) {
        throw new Error("handoff_session_missing");
      }
      const publicSession = await sessionManager.restoreSession(session);
      await sessionManager.broadcastAuthHydration({ source: "bridge_restore" });
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
      const created = await apiClient.createAuthAttempt({ redirect_path: "/dashboard" });
      const attempt = readAttemptPayload(created);
      if (!attempt.attemptId || !attempt.attemptToken) {
        throw new Error("auth_attempt_create_failed");
      }
      await writePendingAttempt({
        attempt_id: attempt.attemptId,
        attempt_token: attempt.attemptToken,
        expires_at: attempt.expiresAt,
      });
      logger.info("Auth attempt created", { attempt_id: attempt.attemptId });
      const authUrl = `${BACKEND_BASE_URL}/auth?source=extension&attempt=${encodeURIComponent(attempt.attemptId)}`;
      await chrome.tabs.create({ url: authUrl });
      void restoreFromAttempt({
        attemptId: attempt.attemptId,
        attemptToken: attempt.attemptToken,
      }).catch((error) => {
        logger.warn("Auth attempt completion failed", { attempt_id: attempt.attemptId, error: error?.message });
      });
      return { ok: true, data: { attempt_id: attempt.attemptId } };
    },
    async resumePendingAuthAttempt() {
      const pending = await readPendingAttempt();
      if (!pending?.attempt_id || !pending?.attempt_token) {
        return { ok: true, data: { resumed: false } };
      }
      try {
        logger.info("Resuming pending auth attempt", { attempt_id: pending.attempt_id });
        return await restoreFromAttempt({
          attemptId: pending.attempt_id,
          attemptToken: pending.attempt_token,
        });
      } catch (error) {
        const code = error?.message || "auth_attempt_resume_failed";
        logger.warn("Pending auth attempt resume failed", { attempt_id: pending.attempt_id, error: code });
        if (code === "auth_attempt_expired" || code === "auth_attempt_invalid") {
          await clearPendingAttempt();
        }
        return { ok: false, error: code };
      }
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
