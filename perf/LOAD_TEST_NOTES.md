# Interpreting the provided k6 load-test output

## Quick take
The run appears to be **latency-healthy but correctness-noisy**:

- Latency SLOs are mostly met globally (`p95=1.48s`, `p99=2.07s`) with one endpoint miss on `/api/me` p95.
- Many "failed checks" are **intentional plan-gating responses** (403s) and should usually be treated as expected in mixed-tier scenarios.
- The largest true app issues in this run are repeated **500s** on citation-related endpoints and frequent **401s** on history calls in paid tiers.

## Why many WARN lines are expected by design
Several WARNs match explicit entitlement rules in the backend:

- Free users are blocked from history search (`403`).
- Free users are blocked from bookmarks (`403`) unless Standard or above.
- Free users are blocked from monthly reports (`403`) unless paid.
- Standard users are blocked from custom citation templates (`403`) unless Pro.
- Standard users are blocked from ZIP export (`403`) unless Pro.

Those should not automatically count as reliability regressions if the scenario intentionally probes locked features.

## Signals that *do* look unhealthy
1. Citation endpoints repeatedly return 500:
   - `/api/citations/by_ids` -> `"Failed to load citations"`
   - `/api/citation-templates` (for Pro) -> `"Failed to load citation templates"`

2. Paid-tier history checks frequently return 401 `"Missing or invalid token"`, suggesting auth token setup in the k6 script or auth handoff data may be invalid/expired for those scenario branches.

3. `http_req_failed=48.06%` is inflated by expected 401/403 traffic plus true 500s; this metric is hard to action unless split into expected vs unexpected failure classes.

4. `rate_limited_rate=10.88%` exceeds threshold and may reflect either an aggressive profile for current quotas or missing per-scenario pacing.

## Suggested next actions
1. **Separate expected gating from errors in checks/thresholds**
   - For free/standard scenarios, explicitly accept entitlement 403s as success for gated endpoints.
   - Track a dedicated metric for unexpected 5xx only.

2. **Fix auth fixture quality in paid scenarios**
   - Ensure `Authorization: Bearer <token>` is populated for `pro_tier` and `standard_tier` history paths, and token freshness exceeds test runtime.

3. **Investigate citation backend 500s first**
   - Validate Supabase table access and user scoping for `citation_templates` and `citations` queries.
   - Log upstream response status/body for non-200 Supabase responses on these routes to avoid opaque `500` envelopes.

4. **Tune rate-limit expectations**
   - Either lower scenario pressure or raise threshold only if 429 behavior is intentionally part of normal operation.

## Practical interpretation for this specific run
- **Performance**: mostly acceptable under this load profile.
- **Functional quality**: not acceptable yet for paid workflows due to citation 500s and paid-history 401s.
- **Test design quality**: currently mixes expected entitlement denials with true failures, which obscures regressions.
