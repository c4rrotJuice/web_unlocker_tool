# Extension AGENTS.md

## Extension Architecture Rules
- Respect MV3 boundaries and keep responsibilities split across background, sidepanel, popup, content, shared, storage, and auth layers.
- Background is the only network/auth/sync authority.
- Use canonical backend endpoints only.
- Preserve secure auth handoff and exchange behavior.
- Keep host-page overlays isolated and non-invasive.

## Surface Ownership
### Background owns
- session authority
- API request composition
- token attachment
- sync queue/replay/reconciliation
- handoff issuance
- capability snapshot cache for UX hints only

### Content owns
- selection watching
- page metadata extraction
- isolated capture overlay
- lightweight intent dispatch only

### Sidepanel owns
- persistent workspace UI
- recent/local capture visibility
- sync state visibility
- queue/retry surfaces

### Popup owns
- quick launcher/status only

## Local Persistence and Sync Rules
- Local-first queue/replay logic is authoritative for offline resilience, not entitlement truth.
- Reconciliation must preserve deterministic local->remote mapping and idempotency.
- Do not silently drop lineage dependencies across citations, quotes, notes, or work-in-editor payloads.
- Use `chrome.storage.local` for lightweight session/UI snapshots and IndexedDB for durable research/queue data.

## UI Rules
- Keep sidepanel lightweight.
- Keep popup extremely light.
- Content-script UI must use CSS isolation, preferably shadow DOM.
- Do not turn the extension into a second full app shell.

## Security Rules
- No weak cookie bridge behavior.
- No token, handoff code, or raw session payload logging.
- Only safe internal destinations for handoff/open-editor flows.
- Backend capability state is final policy truth.

## Validation
- replay/reconciliation tests
- auth restore tests
- handoff tests
- queue recovery tests
- canonical contract compliance tests
- host-page isolation checks where practical
