// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { AUTH_STATUS, createAuthErrorState, createLoadingAuthState, createRefreshingAuthState, createSignedInAuthState, createSignedOutAuthState, } from "../../shared/types/auth.js";
function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
export function createBackgroundStateStore(initialState = createLoadingAuthState(), options = {}) {
    const onChange = typeof options?.onChange === "function" ? options.onChange : null;
    let state = clone(initialState);
    return {
        getState() {
            return clone(state);
        },
        setState(nextState) {
            state = clone(nextState);
            const snapshot = this.getState();
            onChange?.(snapshot);
            return snapshot;
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
        setRefreshing(reason = "refreshing", previousState = null) {
            const baseline = previousState && typeof previousState === "object" ? previousState : state;
            return this.setState(createRefreshingAuthState({
                reason,
                session: baseline?.session || null,
                bootstrap: baseline?.bootstrap || null,
            }));
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
