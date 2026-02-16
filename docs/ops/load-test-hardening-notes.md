# Load-test hardening notes (2026-02)

## Endpoint behavior clarifications

- `GET /api/citations/by_ids`
  - Empty `ids` now returns `200 []`.
  - Invalid `ids` format now returns `422` with `detail.code=CITATION_IDS_INVALID`.
  - Upstream storage failures now return `503` with a stable machine-readable code (`CITATIONS_FETCH_FAILED` / `CITATIONS_DEPENDENCY_ERROR`) instead of opaque `500`.

- `GET /api/citation-templates`
  - Pro/dev users with no templates receive `200 []`.
  - Upstream storage failures now return `503` with stable machine-readable codes (`CITATION_TEMPLATES_FETCH_FAILED` / `CITATION_TEMPLATES_DEPENDENCY_ERROR`) instead of opaque `500`.

- `GET /api/history`
  - Authentication now consistently uses middleware-populated request state.
  - Missing auth returns machine-readable `401` (`AUTH_MISSING`) and tier lock remains strict with `403` (`HISTORY_SEARCH_TIER_LOCKED`).
