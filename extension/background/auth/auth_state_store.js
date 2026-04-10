// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { STORAGE_KEYS } from "../../shared/constants/storage_keys.js";
import { toPublicAuthState } from "../../shared/types/auth.js";
function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
export function createAuthStateStorage({ chromeApi = globalThis.chrome, storageKey = STORAGE_KEYS.AUTH_STATE, } = {}) {
    const storage = chromeApi?.storage?.local;
    if (!storage) {
        throw new Error("chrome.storage.local is required for auth state storage.");
    }
    return {
        async read() {
            const result = await storage.get({ [storageKey]: null });
            const snapshot = result?.[storageKey] ?? null;
            return snapshot ? toPublicAuthState(snapshot) : null;
        },
        async write(authState) {
            const snapshot = toPublicAuthState(authState);
            await storage.set({ [storageKey]: snapshot });
            return clone(snapshot);
        },
        async clear() {
            await storage.remove(storageKey);
        },
    };
}
