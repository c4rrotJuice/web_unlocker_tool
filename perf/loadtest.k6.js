import http from "k6/http";
import { check } from "k6";

const BASE_URL = (__ENV.BASE_URL || "https://web-unlocker-tool.onrender.com").replace(/\/$/, "");

const FREE_BEARER = __ENV.FREE_BEARER || "";
const STANDARD_BEARER = __ENV.STANDARD_BEARER || "";
const PRO_BEARER = __ENV.PRO_BEARER || "";

function headersForToken(token) {
  return token ? { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` } : {};
}

function isGated403(res) {
  if (res.status !== 403) return false;
  let payload;
  try {
    payload = res.json();
  } catch (_) {
    return false;
  }
  const detail = payload?.detail || payload;
  if (!detail || typeof detail !== "object") return false;
  return typeof detail.code === "string" || typeof detail.message === "string";
}

function assertTierEndpoint(tier, endpoint, res, expectedStatuses) {
  return check(res, {
    [`${tier}/${endpoint}: expected status`]: (r) => expectedStatuses.includes(r.status),
    [`${tier}/${endpoint}: no 5xx`]: (r) => r.status < 500,
    [`${tier}/${endpoint}: no unexpected 401`]: (r) => {
      if (expectedStatuses.includes(401)) return true;
      return r.status !== 401;
    },
    [`${tier}/${endpoint}: gated 403 payload`]: (r) => {
      if (r.status !== 403) return true;
      return isGated403(r);
    },
  });
}

const endpointExpectations = {
  free: {
    "/api/reports/monthly": [403],
    "/api/history": [403],
    "/api/bookmarks": [403],
    "/api/citation-templates": [403],
    "/api/docs/export/zip": [403],
    "/api/citations/by_ids?ids=1,2,3": [200, 422],
  },
  standard: {
    "/api/reports/monthly": [200],
    "/api/history": [200],
    "/api/bookmarks": [200],
    "/api/citation-templates": [403],
    "/api/docs/export/zip": [403],
    "/api/citations/by_ids?ids=1,2,3": [200, 422],
  },
  pro: {
    "/api/reports/monthly": [200],
    "/api/history": [200],
    "/api/bookmarks": [200],
    "/api/citation-templates": [200],
    "/api/docs/export/zip": [200],
    "/api/citations/by_ids?ids=1,2,3": [200, 422],
  },
};

export const options = {
  vus: 1,
  iterations: 1,
};

function runTier(tier, token) {
  if (!token) return;
  const headers = headersForToken(token);
  for (const [path, expectedStatuses] of Object.entries(endpointExpectations[tier])) {
    const res = http.get(`${BASE_URL}${path}`, { headers, tags: { tier, endpoint: path } });
    assertTierEndpoint(tier, path, res, expectedStatuses);
  }
}

export default function () {
  runTier("free", FREE_BEARER);
  runTier("standard", STANDARD_BEARER);
  runTier("pro", PRO_BEARER);
}
