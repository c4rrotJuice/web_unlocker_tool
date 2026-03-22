import { AUTH_STATUS, createAuthErrorState, createLoadingAuthState, createSignedInAuthState, createSignedOutAuthState } from "../../shared/types/auth.js";
export { createCitationStateStore } from "./citation_state.js";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createBackgroundStateStore(initialState = createLoadingAuthState()) {
  let state = clone(initialState);

  return {
    getState() {
      return clone(state);
    },
    setState(nextState) {
      state = clone(nextState);
      return this.getState();
    },
    setLoading(reason = "startup") {
      return this.setState(createLoadingAuthState(reason));
    },
    setSignedOut(reason = "signed_out") {
      return this.setState(createSignedOutAuthState(reason));
    },
    setSignedIn({ session, bootstrap }) {
      return this.setState(createSignedInAuthState({ session, bootstrap }));
    },
    setError(error, reason = "auth_error") {
      return this.setState(createAuthErrorState(error, reason));
    },
    clear() {
      return this.setSignedOut("cleared");
    },
    isSignedIn() {
      return state.status === AUTH_STATUS.SIGNED_IN;
    },
  };
}
