const AUTH_ERROR_CODES = new Set([
  "missing_credentials",
  "invalid_token",
  "expired_token",
  "auth_required",
  "token_expired",
  "session_lost",
]);

function defaultMessageForCode(code) {
  if (code === "expired_token") return "Session expired. Please sign in again.";
  if (code === "invalid_token") return "The current session is invalid. Please sign in again.";
  return "Missing bearer token.";
}

export function createAuthSessionError(code = "missing_credentials", message = null, details = {}) {
  const error = new Error(message || defaultMessageForCode(code));
  error.name = "AuthSessionError";
  error.code = code;
  error.status = details.status ?? 401;
  error.payload = details.payload ?? null;
  error.requestPath = details.requestPath ?? null;
  error.authSessionLost = true;
  return error;
}

export function isAuthSessionError(error) {
  if (!error) return false;
  if (error.name === "AuthSessionError" || error.authSessionLost === true) return true;
  if (error.code && AUTH_ERROR_CODES.has(error.code)) return true;
  const payloadCode = error?.payload?.error?.code || error?.payload?.error_code || error?.payload?.code;
  if (payloadCode && AUTH_ERROR_CODES.has(payloadCode)) return true;
  return false;
}

export function createAuthSessionErrorFromPayload(payload, status, requestPath = null) {
  const payloadCode = payload?.error?.code || payload?.error_code || payload?.code || null;
  if (!payloadCode && status !== 401) {
    return null;
  }

  const code = AUTH_ERROR_CODES.has(payloadCode) ? payloadCode : (status === 401 ? "missing_credentials" : null);
  if (!code) return null;

  const message = payload?.error?.message || payload?.detail || payload?.message || defaultMessageForCode(code);
  return createAuthSessionError(code, message, { status, payload, requestPath });
}

export function normalizeAuthError(error, { requestPath = null, defaultCode = "missing_credentials" } = {}) {
  if (isAuthSessionError(error)) {
    return error;
  }
  return createAuthSessionError(
    error?.code && AUTH_ERROR_CODES.has(error.code) ? error.code : defaultCode,
    error?.message || defaultMessageForCode(defaultCode),
    {
      status: error?.status ?? 401,
      payload: error?.payload ?? null,
      requestPath,
    },
  );
}
