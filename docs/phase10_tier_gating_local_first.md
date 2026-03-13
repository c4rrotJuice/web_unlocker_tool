# Phase 10 — Local-First Tier Gating

## Objective
Perform feature gating locally first using cached tier data before server contact.

## Tier cache model

Stored in `chrome.storage.local` as `tier_cache`:

```js
tierCache = {
  tier: "free" | "standard" | "pro",
  is_authenticated: boolean,
  citations_remaining: number,
  documents_remaining: number,
  reset_timestamp: number,
  sync_enabled: boolean,
}
```

## Local tier policy defaults

- Free (anonymous): citations `5/week`, documents `0`, sync `false`
- Free (authenticated): citations `10/day`, documents `3` per period, sync `true`
- Standard: citations `15/day`, documents `14/2 weeks`, sync `true`
- Pro: citations unlimited, documents unlimited, sync `true`

## Local-first gating behavior

### Citation gating (`SAVE_CITATION`)
1. Background runs local gate check first (`consumeTierCredit("citations")`).
2. If exhausted, returns local `403` immediately (no server call).
3. If allowed, decrements local counter, persists local citation, then enqueues async server sync.

### Document/editor gating (`WORK_IN_EDITOR`)
1. Background runs local gate check first (`consumeTierCredit("documents")`).
2. If exhausted, returns local `403` immediately.
3. If allowed, decrements local counter and continues existing editor flow.

## Cache lifecycle

- Cache is hydrated/refreshed from usage snapshot + session context.
- Auto-reset runs locally when `reset_timestamp` is reached.
- Cache is cleared on logout.

## Result
Tier checks now happen locally before any server contact for gated actions, improving responsiveness and enforcing local-first behavior.
