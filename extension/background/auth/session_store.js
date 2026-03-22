import { STORAGE_KEYS } from "../../shared/constants/storage_keys.js";
import { normalizeSession } from "../../shared/types/auth.js";
function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
export function createSessionStore({ chromeApi = globalThis.chrome, storageKey = STORAGE_KEYS.AUTH_SESSION, legacyStorageKey = STORAGE_KEYS.AUTH_SESSION_LEGACY, } = {}) {
    const storage = chromeApi?.storage?.local;
    if (!storage) {
        throw new Error("chrome.storage.local is required for the session store.");
    }
    return {
        async read() {
            const result = await storage.get({ [storageKey]: null, [legacyStorageKey]: null });
            const primary = normalizeSession(result?.[storageKey] ?? null);
            if (primary) {
                return primary ? clone(primary) : null;
            }
            const legacy = normalizeSession(result?.[legacyStorageKey] ?? null);
            if (legacy) {
                await storage.set({ [storageKey]: legacy });
                await storage.remove(legacyStorageKey);
            }
            const normalized = legacy;
            return normalized ? clone(normalized) : null;
        },
        async write(session) {
            const normalized = normalizeSession(session);
            if (!normalized) {
                throw new Error("A valid session with an access token is required.");
            }
            await storage.set({ [storageKey]: normalized });
            if (legacyStorageKey) {
                await storage.remove(legacyStorageKey);
            }
            return clone(normalized);
        },
        async clear() {
            await storage.remove(storageKey);
            if (legacyStorageKey) {
                await storage.remove(legacyStorageKey);
            }
        },
        async getToken() {
            const session = await this.read();
            return session?.access_token || null;
        },
    };
}
