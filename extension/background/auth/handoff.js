// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { API_ORIGIN, ENDPOINTS } from "../../shared/constants/endpoints.js";
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.js";
import { createErrorResult, ERROR_CODES, createOkResult } from "../../shared/types/messages.js";
import { normalizeSession } from "../../shared/types/auth.js";
const CANONICAL_AUTH_ERRORS = new Set([
    ERROR_CODES.HANDOFF_INVALID,
    ERROR_CODES.HANDOFF_EXPIRED,
    ERROR_CODES.HANDOFF_ALREADY_USED,
    ERROR_CODES.AUTH_ATTEMPT_INVALID,
    ERROR_CODES.AUTH_ATTEMPT_EXPIRED,
]);
function mapAuthError(result, fallbackCode = ERROR_CODES.AUTH_INVALID) {
    const code = result?.error?.code;
    if (CANONICAL_AUTH_ERRORS.has(code)) {
        return code;
    }
    return fallbackCode;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildAuthAttemptUrl(baseUrl, { attemptId, redirectPath = "/dashboard" }) {
    const url = new URL(ENDPOINTS.AUTH_PAGE, baseUrl);
    url.searchParams.set("source", "extension");
    url.searchParams.set("attempt", attemptId);
    url.searchParams.set("next", redirectPath);
    return url.toString();
}
function sanitizeRedirectPath(baseUrl, redirectPath) {
    if (typeof redirectPath !== "string" || !redirectPath.trim()) {
        return "/dashboard";
    }
    const normalized = redirectPath.trim();
    if (normalized.startsWith("/")) {
        return normalized;
    }
    try {
        const base = new URL(baseUrl);
        const parsed = new URL(normalized, base);
        if (parsed.origin !== base.origin) {
            return "/dashboard";
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/dashboard";
    }
    catch {
        return "/dashboard";
    }
}
export function createHandoffManager(options = {}) {
    const typedOptions = options;
    const apiClient = typedOptions.apiClient;
    const sessionStore = typedOptions.sessionStore;
    const sessionManager = typedOptions.sessionManager;
    const stateStore = typedOptions.stateStore;
    const bootstrapHandler = typedOptions.bootstrapHandler;
    const chromeApi = typedOptions.chromeApi || globalThis.chrome;
    const baseUrl = typedOptions.baseUrl || API_ORIGIN;
    const pollIntervalMs = typedOptions.pollIntervalMs || 250;
    const maxPollAttempts = typedOptions.maxPollAttempts || 40;
    if (!apiClient || !sessionStore || !sessionManager || !stateStore || !bootstrapHandler) {
        throw new Error("createHandoffManager requires apiClient, sessionStore, sessionManager, stateStore, and bootstrapHandler.");
    }
    let startInFlight = null;
    async function pollForReadyAttempt({ attemptId, attemptToken, requestId }) {
        for (let index = 0; index < maxPollAttempts; index += 1) {
            const statusResult = await apiClient.getAuthAttemptStatus({ attemptId, attemptToken });
            if (statusResult.ok === false) {
                const code = mapAuthError(statusResult, ERROR_CODES.AUTH_ATTEMPT_INVALID);
                return createErrorResult(code, statusResult.error.message, requestId, statusResult.error.details ?? null);
            }
            const exchange = statusResult.data?.exchange || null;
            if (statusResult.data?.status === "ready" && typeof exchange?.code === "string" && exchange.code.trim()) {
                return createOkResult({
                    attempt: statusResult.data,
                    exchangeCode: exchange.code,
                }, requestId);
            }
            await delay(pollIntervalMs);
        }
        return createErrorResult(ERROR_CODES.AUTH_ATTEMPT_EXPIRED, "Authentication attempt did not become ready in time.", requestId);
    }
    async function openAuthWindow(url) {
        if (typeof chromeApi?.windows?.create !== "function") {
            return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "windows.create is unavailable for auth start.");
        }
        const created = await chromeApi.windows.create({
            url,
            focused: true,
            type: "popup",
            width: 460,
            height: 640,
        });
        return createOkResult({ windowId: created?.id || null, url });
    }
    async function closeAuthWindow(windowId) {
        if (!windowId || typeof chromeApi?.windows?.remove !== "function") {
            return;
        }
        try {
            await chromeApi.windows.remove(windowId);
        }
        catch { }
    }
    async function exchangeAndBootstrap({ code, requestId }) {
        const exchangeResult = await apiClient.exchangeHandoff({ code });
        if (exchangeResult.ok === false) {
            const codeValue = mapAuthError(exchangeResult, ERROR_CODES.AUTH_INVALID);
            await sessionManager.clearSession("handoff_exchange_failed");
            const auth = stateStore.setError({
                code: codeValue,
                message: exchangeResult.error.message,
                details: exchangeResult.error.details ?? null,
            }, "handoff_exchange_failed");
            await sessionManager.persistAuthState(auth);
            return createErrorResult(codeValue, exchangeResult.error.message, requestId, exchangeResult.error.details ?? null);
        }
        const normalizedSession = normalizeSession({
            ...exchangeResult.data?.session,
            source: "handoff_exchange",
        });
        if (!normalizedSession?.access_token) {
            await sessionManager.clearSession("handoff_exchange_failed");
            const auth = stateStore.setError({
                code: ERROR_CODES.AUTH_INVALID,
                message: "Handoff exchange did not return a session.",
            }, "handoff_exchange_failed");
            await sessionManager.persistAuthState(auth);
            return createErrorResult(ERROR_CODES.AUTH_INVALID, "Handoff exchange did not return a session.", requestId);
        }
        await sessionStore.write(normalizedSession);
        await sessionManager.persistAuthState(stateStore.setSignedIn({
            session: normalizedSession,
            bootstrap: stateStore.getState()?.bootstrap || null,
        }));
        const bootstrapResult = await bootstrapHandler.fetch({
            type: "bootstrap.fetch",
            requestId,
            payload: { surface: "background" },
        });
        if (bootstrapResult.ok === false) {
            return bootstrapResult;
        }
        const validBootstrap = validateBootstrapSnapshot(bootstrapResult.data.auth.bootstrap);
        if (validBootstrap.ok === false) {
            return validBootstrap;
        }
        return createOkResult({ auth: stateStore.getState() }, requestId);
    }
    return {
        async start(request) {
            if (startInFlight) {
                return startInFlight;
            }
            startInFlight = (async () => {
                const redirectPath = sanitizeRedirectPath(baseUrl, request?.payload?.redirectPath);
                stateStore.setLoading("auth_start");
                const attemptResult = await apiClient.createAuthAttempt({ redirect_path: redirectPath });
                if (attemptResult.ok === false) {
                    const code = mapAuthError(attemptResult, ERROR_CODES.AUTH_ATTEMPT_INVALID);
                    const auth = stateStore.setError({
                        code,
                        message: attemptResult.error.message,
                        details: attemptResult.error.details ?? null,
                    }, "auth_attempt_create_failed");
                    await sessionManager.persistAuthState(auth);
                    return createErrorResult(code, attemptResult.error.message, request.requestId, attemptResult.error.details ?? null);
                }
                const attemptId = attemptResult.data?.attempt_id;
                const attemptToken = attemptResult.data?.attempt_token;
                if (typeof attemptId !== "string" || typeof attemptToken !== "string") {
                    const auth = stateStore.setError({ code: ERROR_CODES.AUTH_ATTEMPT_INVALID, message: "Auth attempt response was invalid." }, "auth_attempt_invalid");
                    await sessionManager.persistAuthState(auth);
                    return createErrorResult(ERROR_CODES.AUTH_ATTEMPT_INVALID, "Auth attempt response was invalid.", request.requestId);
                }
                const authUrl = buildAuthAttemptUrl(baseUrl, { attemptId, redirectPath });
                const openResult = await openAuthWindow(authUrl);
                if (openResult.ok === false) {
                    const auth = stateStore.setError(openResult.error, "auth_tab_open_failed");
                    await sessionManager.persistAuthState(auth);
                    return createErrorResult(openResult.error.code, openResult.error.message, request.requestId, openResult.error.details ?? null);
                }
                const readyResult = await pollForReadyAttempt({ attemptId, attemptToken, requestId: request.requestId });
                if (readyResult.ok === false) {
                    const auth = stateStore.setError(readyResult.error, "auth_attempt_poll_failed");
                    await sessionManager.persistAuthState(auth);
                    return readyResult;
                }
                const exchanged = await exchangeAndBootstrap({
                    code: readyResult.data.exchangeCode,
                    requestId: request.requestId,
                });
                if (exchanged.ok) {
                    await closeAuthWindow(openResult.data?.windowId || null);
                }
                return exchanged;
            })().finally(() => {
                startInFlight = null;
            });
            return startInFlight;
        },
    };
}
