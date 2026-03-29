import { API_ORIGIN, ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { validateResultEnvelope } from "../../shared/contracts/validators.ts";
import { createErrorResult, ERROR_CODES } from "../../shared/types/messages.ts";

function toUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

function mapHttpError(status, fallbackCode: string = ERROR_CODES.NETWORK_ERROR) {
  if (status === 401 || status === 403) {
    return ERROR_CODES.UNAUTHORIZED;
  }
  return fallbackCode;
}

function mapBackendDetailError(payload: any, status: number, fallbackCode: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) {
    return createErrorResult(
      mapHttpError(status, fallbackCode),
      detail.trim(),
      undefined,
      payload,
      { status },
    );
  }
  if (detail && typeof detail === "object") {
    return createErrorResult(
      typeof detail.code === "string" && detail.code.trim() ? detail.code.trim() : mapHttpError(status, fallbackCode),
      typeof detail.message === "string" && detail.message.trim() ? detail.message.trim() : `Request failed with ${status}.`,
      undefined,
      detail.details ?? payload,
      { status },
    );
  }
  return null;
}

async function parseJson(response) {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return createErrorResult(
      ERROR_CODES.NETWORK_ERROR,
      "Response body was not valid JSON.",
      undefined,
      { cause: error?.message || String(error) },
    );
  }
}

export function createApiClient({
  baseUrl = API_ORIGIN,
  fetchImpl = globalThis.fetch,
  getAccessToken = async () => null,
  refreshAccessToken = async () => null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required for the API client.");
  }

  async function request(path, options = {}) {
    const typedOptions: any = options;
    const method = typedOptions.method || "GET";
    const body = typedOptions.body;
    const auth = typedOptions.auth === true;
    const headers = typedOptions.headers || {};
    const fallbackCode = typedOptions.fallbackCode || ERROR_CODES.NETWORK_ERROR;
    const label = typedOptions.label || "Backend response";

    async function performRequest(accessTokenOverride: string | null = null) {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Accept", "application/json");

      if (body !== undefined) {
        requestHeaders.set("Content-Type", "application/json");
      }

      if (auth) {
        const accessToken = accessTokenOverride || await getAccessToken();
        if (!accessToken) {
          return createErrorResult(ERROR_CODES.UNAUTHORIZED, "No bearer token is available.");
        }
        requestHeaders.set("Authorization", `Bearer ${accessToken}`);
      }

      try {
        return await fetchImpl(toUrl(baseUrl, path), {
          method,
          headers: requestHeaders,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        return createErrorResult(
          ERROR_CODES.NETWORK_ERROR,
          "Network request failed.",
          undefined,
          { cause: error?.message || String(error) },
        );
      }
    }

    let response: any = await performRequest();
    if (response?.ok === false && response?.status === "error") {
      return response;
    }

    if (auth && (response.status === 401 || response.status === 403)) {
      const refreshedAccessToken = await refreshAccessToken();
      if (refreshedAccessToken) {
        response = await performRequest(refreshedAccessToken);
        if (response?.ok === false && response?.status === "error") {
          return response;
        }
      }
    }

    const parsed = await parseJson(response);
    if (parsed?.ok === false && parsed?.status === "error") {
      return parsed;
    }

    if (!response.ok) {
      const mappedDetailError = mapBackendDetailError(parsed, response.status, fallbackCode);
      if (mappedDetailError) {
        return mappedDetailError;
      }
    }

    const normalized: any = validateResultEnvelope(parsed, { fallbackCode, label });
    if (response.ok) {
      return normalized;
    }

    if (normalized.ok === false) {
      return createErrorResult(normalized.error.code, normalized.error.message, undefined, normalized.error.details ?? null, { status: response.status });
    }

    return createErrorResult(
      mapHttpError(response.status, fallbackCode),
      `Request failed with ${response.status}.`,
      undefined,
      parsed,
      { status: response.status },
    );
  }

  return {
    request,
    createAuthAttempt(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF_ATTEMPTS, {
        method: "POST",
        body: payload,
        fallbackCode: ERROR_CODES.AUTH_ATTEMPT_INVALID,
        label: "Auth attempt create response",
      });
    },
    getAuthAttemptStatus({ attemptId, attemptToken }) {
      return request(
        ENDPOINTS.AUTH_HANDOFF_ATTEMPT_STATUS.replace("{attempt_id}", encodeURIComponent(attemptId)),
        {
          headers: {
            "X-Auth-Attempt-Token": attemptToken,
          },
          fallbackCode: ERROR_CODES.AUTH_ATTEMPT_INVALID,
          label: "Auth attempt status response",
        },
      );
    },
    exchangeHandoff(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF_EXCHANGE, {
        method: "POST",
        body: payload,
        fallbackCode: ERROR_CODES.HANDOFF_INVALID,
        label: "Handoff exchange response",
      });
    },
    refreshSession(payload) {
      return request(ENDPOINTS.AUTH_HANDOFF_REFRESH, {
        method: "POST",
        body: payload,
        fallbackCode: ERROR_CODES.HANDOFF_REFRESH_FAILED,
        label: "Handoff refresh response",
      });
    },
    loadBootstrap() {
      return request(ENDPOINTS.BOOTSTRAP, {
        auth: true,
        fallbackCode: ERROR_CODES.BOOTSTRAP_FAILED,
        label: "Extension bootstrap response",
      });
    },
    listCitations({ limit = 8, offset = 0, query = "" } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (Number.isInteger(offset) && offset > 0) {
        params.set("cursor", String(offset));
      }
      if (String(query || "").trim()) {
        params.set("search", String(query).trim());
      }
      return request(`${ENDPOINTS.CITATIONS}?${params.toString()}`, {
        auth: true,
        fallbackCode: ERROR_CODES.NETWORK_ERROR,
        label: "Citations list response",
      });
    },
    listNotes({ limit = 8, offset = 0, query = "" } = {}) {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (String(query || "").trim()) {
        params.set("query", String(query).trim());
      }
      return request(`${ENDPOINTS.NOTES}?${params.toString()}`, {
        auth: true,
        fallbackCode: ERROR_CODES.NETWORK_ERROR,
        label: "Notes list response",
      });
    },
    updateNote({ noteId, ...payload }) {
      return request(`${ENDPOINTS.NOTES}/${encodeURIComponent(String(noteId || ""))}`, {
        method: "PATCH",
        body: payload,
        auth: true,
        fallbackCode: ERROR_CODES.NETWORK_ERROR,
        label: "Note update response",
      });
    },
  };
}
