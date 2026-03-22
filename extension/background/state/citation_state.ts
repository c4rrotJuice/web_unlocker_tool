import { normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.ts";

function clone(value: any) {
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

export function createCitationStateStore(initialState = createInitialState()) {
  let state = clone(initialState);

  return {
    getState() {
      return clone(state);
    },
    saveSelection({
      citationId,
      style,
      format,
      copy = false,
    }: any = {}) {
      state = {
        citationId: String(citationId || "").trim() || null,
        selectedStyle: normalizeCitationStyle(style || state.selectedStyle),
        selectedFormat: normalizeCitationFormat(format || state.selectedFormat),
        saved: true,
        copied: Boolean(copy),
        savedAt: new Date().toISOString(),
      };
      return this.getState();
    },
    clear() {
      state = createInitialState();
      return this.getState();
    },
  };
}
