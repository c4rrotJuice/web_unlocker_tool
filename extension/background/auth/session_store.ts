import { STORAGE_KEYS } from "../../shared/constants/storage_keys.ts";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function getChromeStorage(chromeApi = globalThis.chrome) {
  return chromeApi?.storage?.local;
}

export function createSessionStore({ chromeApi = globalThis.chrome, storageKey = STORAGE_KEYS.AUTH_SESSION } = {}) {
  const storage = getChromeStorage(chromeApi);
  if (!storage) {
    throw new Error("chrome.storage.local is required for the session store.");
  }

  return {
    async read() {
      const result = await storage.get({ [storageKey]: null });
      const stored = result?.[storageKey] ?? null;
      return stored ? clone(stored) : null;
    },
    async write(session) {
      const snapshot = {
        access_token: session.access_token,
        token_type: session.token_type || "bearer",
        user_id: session.user_id || null,
        email: session.email || null,
        issued_at: session.issued_at || new Date().toISOString(),
        expires_at: session.expires_at || null,
        source: session.source || "background",
      };
      await storage.set({ [storageKey]: snapshot });
      return clone(snapshot);
    },
    async clear() {
      await storage.remove(storageKey);
    },
    async getToken() {
      const session = await this.read();
      return session?.access_token || null;
    },
  };
}
