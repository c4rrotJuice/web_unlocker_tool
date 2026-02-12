export const COPY = {
  errors: {
    INVALID_URL: "Please enter a valid URL.",
    HUMAN_VERIFICATION_REQUIRED: "This page needs human verification before unlock.",
    DAILY_LIMIT_REACHED: "You've reached your daily unlock limit.",
    WEEKLY_LIMIT_REACHED: "You've reached your weekly unlock limit.",
    FETCH_TIMEOUT: "Request timed out. Please try again.",
    UPSTREAM_BLOCKED: "This site blocked the unlock request.",
    AUTH_REQUIRED: "Please sign in to continue.",
    TOKEN_EXPIRED: "Your session expired. Please sign in again.",
    RATE_LIMITED: "Too many requests. Please retry shortly.",
    SERVER_ERROR: "Unexpected server error.",
    DEFAULT: "Something went wrong.",
  },
  success: {
    LOGIN_SUCCESS: "Signed in successfully.",
    LOGOUT_SUCCESS: "Signed out successfully.",
    UNLOCK_SUCCESS: "Copy+Cite enabled on this page.",
  },
  info: {
    VERIFYING_AUTH: "Verifying session…",
    PROCESSING_REQUEST: "Processing request…",
    UNLOCK_STARTED: "Starting unlock…",
    FETCHING_CONTENT: "Fetching content…",
    CLEANING_CONTENT: "Cleaning content…",
  },
};

export function mapApiError(payload = {}) {
  const nested = payload?.error || {};
  const code = nested.code || payload.error_code || "SERVER_ERROR";
  return {
    code,
    message: COPY.errors[code] || nested.message || payload.message || COPY.errors.DEFAULT,
    type: code === "RATE_LIMITED" ? "warning" : "error",
    cta: code === "AUTH_REQUIRED" || code === "TOKEN_EXPIRED" ? { label: "Sign in", href: "/auth" } : null,
  };
}
