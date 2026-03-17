export function createSelectionState() {
  let state = {
    range: null,
    text: "",
    collapsed: true,
    composing: false,
  };
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
    setSelection(payload) {
      state = {
        ...state,
        ...payload,
      };
      notify();
    },
    setComposing(composing) {
      state = {
        ...state,
        composing: !!composing,
      };
      notify();
    },
  };
}
