// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { STORAGE_KEYS } from "../../shared/constants/storage_keys.js";
import { normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
function createInitialState() {
    return {
        citationId: null,
        selectedStyle: "apa",
        selectedFormat: "bibliography",
        saved: false,
        copied: false,
        savedAt: null,
    };
}
function normalizeStoredState(value) {
    if (!value || typeof value !== "object") {
        return createInitialState();
    }
    return {
        citationId: typeof value.citationId === "string" && value.citationId.trim() ? value.citationId.trim() : null,
        selectedStyle: normalizeCitationStyle(value.selectedStyle || "apa"),
        selectedFormat: normalizeCitationFormat(value.selectedFormat || "bibliography"),
        saved: Boolean(value.saved),
        copied: Boolean(value.copied),
        savedAt: typeof value.savedAt === "string" && value.savedAt.trim() ? value.savedAt.trim() : null,
    };
}
export function createCitationStateStore(initialState = createInitialState(), { chromeApi = globalThis.chrome, storageKey = STORAGE_KEYS.CITATION_SELECTION, } = {}) {
    let state = clone(initialState);
    let hydrated = false;
    const storage = chromeApi?.storage?.local || null;
    async function persist() {
        if (!storage?.set) {
            return;
        }
        await storage.set({ [storageKey]: state });
    }
    return {
        async hydrate() {
            if (hydrated) {
                return this.getState();
            }
            hydrated = true;
            if (!storage?.get) {
                return this.getState();
            }
            const result = await storage.get({ [storageKey]: null });
            state = normalizeStoredState(result?.[storageKey]);
            return this.getState();
        },
        getState() {
            return clone(state);
        },
        async saveSelection({ citationId, style, format, copy = false, } = {}) {
            state = {
                citationId: String(citationId || "").trim() || null,
                selectedStyle: normalizeCitationStyle(style || state.selectedStyle),
                selectedFormat: normalizeCitationFormat(format || state.selectedFormat),
                saved: true,
                copied: Boolean(copy),
                savedAt: new Date().toISOString(),
            };
            await persist();
            return this.getState();
        },
        async clear() {
            state = createInitialState();
            if (storage?.remove) {
                await storage.remove(storageKey);
            }
            return this.getState();
        },
    };
}
