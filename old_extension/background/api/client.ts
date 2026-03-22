import { API_ORIGIN, ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { createErrorResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { validateResultEnvelope } from "../../shared/contracts/validators.ts";

function toUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function toError(code, message, details = null, meta = null) {
  return createErrorResult(code, message, details, meta);
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return ERROR_CODES.UNAUTHORIZED;
  }
  return ERROR_CODES.NETWORK_ERROR;
}

export function createApiClient({
  baseUrl = API_ORIGIN,
  fetchImpl = globalThis.fetch,
  getAccessToken = async () => null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required for the API client.");
  }

  async function request(path, {
    method = "GET",
    body = undefined,
    auth = true,
    headers = {},
    fallbackCode = ERROR_CODES.NETWORK_ERROR,
    responseValidator = null,
    responseLabel = "Backend response",
  } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Accept", "application/json");
    let accessToken = null;
    if (auth) {
      accessToken = await getAccessToken();
      if (!accessToken) {
        return toError(ERROR_CODES.UNAUTHORIZED, "No bearer token is available.");
      }
      requestHeaders.set("Authorization", `Bearer ${accessToken}`);
    }
    if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
    }
    let response;
    try {
      response = await fetchImpl(toUrl(baseUrl, path), {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return toError(ERROR_CODES.NETWORK_ERROR, "Network request failed.", { cause: error?.message || String(error) });
    }
    let parsed = null;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch (error) {
      return toError(ERROR_CODES.NETWORK_ERROR, "Response body was not valid JSON.", { cause: error?.message || String(error) });
    }
    const normalized = validateResultEnvelope(parsed, {
      label: responseLabel,
      dataValidator: responseValidator,
      fallbackCode,
    });
    if (!response.ok) {
      if (normalized.ok === false) {
        return createErrorResult(normalized.error.code, normalized.error.message, normalized.error.details ?? null, { status: response.status });
      }
      const httpCode = mapHttpError(response.status);
      return createErrorResult(httpCode, `Request failed with ${response.status}.`, parsed, { status: response.status });
    }
    return normalized;
  }

  return {
    request,
    issueHandoff(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF, { method: "POST", auth: true, body: payload, fallbackCode: ERROR_CODES.HANDOFF_INVALID });
    },
    exchangeHandoff(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF_EXCHANGE, { method: "POST", auth: false, body: payload, fallbackCode: ERROR_CODES.HANDOFF_INVALID });
    },
    createAuthAttempt(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF_ATTEMPTS, { method: "POST", auth: false, body: payload, fallbackCode: ERROR_CODES.AUTH_ATTEMPT_INVALID });
    },
    getAuthAttemptStatus({ attempt_id, attempt_token }) {
      const path = ENDPOINTS.AUTH_HANDOFF_ATTEMPT_STATUS.replace("{attempt_id}", encodeURIComponent(attempt_id));
      return request(path, {
        auth: false,
        headers: { "X-Auth-Attempt-Token": attempt_token || "" },
        fallbackCode: ERROR_CODES.AUTH_ATTEMPT_INVALID,
      });
    },
    completeAuthAttempt({ attempt_id, ...payload }) {
      const path = ENDPOINTS.AUTH_HANDOFF_ATTEMPT_COMPLETE.replace("{attempt_id}", encodeURIComponent(attempt_id));
      return request(path, { method: "POST", auth: true, body: payload, fallbackCode: ERROR_CODES.AUTH_ATTEMPT_INVALID });
    },
    listCitations({ limit = 8, offset = 0, query = "" } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (query && String(query).trim()) {
        params.set("query", String(query).trim());
      }
      const path = `${ENDPOINTS.CITATIONS}?${params.toString()}`;
      return request(path, { auth: true, fallbackCode: ERROR_CODES.NETWORK_ERROR });
    },
    listNotes({ limit = 8, offset = 0, query = "" } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (query && String(query).trim()) {
        params.set("query", String(query).trim());
      }
      const path = `${ENDPOINTS.NOTES}?${params.toString()}`;
      return request(path, { auth: true, fallbackCode: ERROR_CODES.NETWORK_ERROR });
    },
    renderCitation(payload) {
      return request(ENDPOINTS.CITATION_RENDER, { method: "POST", auth: true, body: payload, fallbackCode: ERROR_CODES.INVALID_PAYLOAD });
    },
    workInEditor(payload) {
      return request(ENDPOINTS.WORK_IN_EDITOR, { method: "POST", auth: true, body: payload, fallbackCode: ERROR_CODES.INVALID_PAYLOAD });
    },
  };
}
