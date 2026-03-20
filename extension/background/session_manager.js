import { refreshSession } from "../lib/supabase.js";
import { summarizeSession } from "../shared/models.js";
import { createLogger } from "../shared/log.js";
import { readRawSession, writeRawSession } from "../auth/session_store.js";

const logger = createLogger("background:session");
const AUTH_HYDRATION_KEY = "auth_hydration_event";

export function createSessionManager() {
  async function getSession() {
    return readRawSession();
  }

  async function ensureSession({ allowMissing = false } = {}) {
    const session = await getSession();
    if (!session?.access_token) {
      if (allowMissing) return null;
      const error = new Error("auth_required");
      error.status = 401;
      throw error;
    }
    const expiresAtMs = Number(session.expires_at || 0) * 1000;
    if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 30_000) {
      return session;
    }
    if (!session.refresh_token) {
      if (allowMissing) return null;
      const error = new Error("auth_required");
      error.status = 401;
      throw error;
    }
    try {
      const refreshed = await refreshSession(session.refresh_token);
      const merged = { ...session, ...refreshed, user: refreshed?.user || session.user };
      await writeRawSession(merged);
      return merged;
    } catch (error) {
      logger.warn("Session refresh failed", { error: error?.message });
      await writeRawSession(null);
      if (allowMissing) return null;
      const next = new Error("auth_required");
      next.status = 401;
      throw next;
    }
  }

  async function restoreSession(session) {
    const merged = {
      ...session,
      expires_at: session?.expires_at || Math.floor(Date.now() / 1000) + Number(session?.expires_in || 0),
    };
    await writeRawSession(merged);
    logger.info("Session persisted");
    return summarizeSession(merged);
  }

  async function broadcastAuthHydration(payload = {}) {
    await chrome.storage.local.set({
      [AUTH_HYDRATION_KEY]: {
        at: new Date().toISOString(),
        ...payload,
      },
    });
    logger.info("Auth hydration broadcast completed");
  }

  async function handleUnauthorized() {
    await writeRawSession(null);
  }

  async function logout() {
    await writeRawSession(null);
  }

  async function getPublicSessionState() {
    const session = await getSession();
    return summarizeSession(session);
  }

  return {
    getSession,
    ensureSession,
    restoreSession,
    broadcastAuthHydration,
    handleUnauthorized,
    logout,
    getPublicSessionState,
  };
}
