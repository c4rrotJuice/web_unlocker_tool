import { STORAGE_KEYS } from "../../shared/constants/storage_keys.ts";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createAuthStateStorage({
  chromeApi = globalThis.chrome,
  storageKey = STORAGE_KEYS.AUTH_STATE,
} = {}) {
  const storage = chromeApi?.storage?.local;
  if (!storage) {
    throw new Error("chrome.storage.local is required for auth state storage.");
  }

  return {
    async read() {
      const result = await storage.get({ [storageKey]: null });
      const snapshot = result?.[storageKey] ?? null;
      return snapshot ? clone(snapshot) : null;
    },
    async write(authState) {
      await storage.set({ [storageKey]: clone(authState) });
      return clone(authState);
    },
    async clear() {
      await storage.remove(storageKey);
    },
  };
}
