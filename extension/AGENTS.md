# AGENTS.md — Writior Extension (Canonical v2)

## Mission

Build a Chrome MV3 extension that is:
- backend-led
- worker-centered
- thin in UI
- strictly layered
- verifiably alive at runtime

This extension is NOT:
- a local-first app
- an offline system
- a second backend
- a policy engine
- a UI-heavy dashboard

---

## Core Architecture (non-negotiable)

### Source of truth
Backend owns:
- auth
- tier/capabilities/usage
- citations/notes/quotes
- editor launch

Extension must NOT fabricate or compensate.

---

### Layer ownership

**background/**
- ONLY place for:
  - auth
  - token storage
  - API calls
  - orchestration
  - retries
  - session restore
  - editor launch
  - canonical message handling

**content/**
- DOM + page only:
  - selection detection
  - copy unlock
  - page UI (pill)
  - context serialization
- NO backend calls
- NO policy logic

**sidepanel/**
- render + trigger only
- no canonical state ownership

**popup/**
- tiny launcher only

**shared/**
- message contracts
- types
- constants
- validators
- errors

---

## Absolute prohibitions

Do NOT:
- call backend from content/popup/sidepanel
- derive tier/capability/usage locally
- fake guest fallback
- construct `/editor` manually
- duplicate message names
- use ad hoc payloads
- mix JS + TS as parallel runtime truths
- keep ghost architecture alive
- add offline queue/sync system
- add page-bridge auth
- hide failures with fallback logic

---

## Worker rules (critical)

- worker MUST be a real entrypoint (not export-only)
- MUST register listeners on load
- MUST be safe on cold start
- MUST NOT rely on in-memory state
- MUST rehydrate minimal state from storage

If worker does not boot → extension is considered dead.

---

## Messaging rules

All messages:
- defined in shared
- typed
- validated
- single contract shape:
  { type, requestId, payload }

NO scattered string messages.

---

## Build truth rules

- manifest MUST point to real built files
- Chrome runtime artifact MUST match inspected source
- NO stale build output
- NO duplicate runtime entry ambiguity

---

## UI philosophy

UI must be:
- thin
- calm
- academic
- fast
- low-noise

### Popup
- status + open sidepanel only

### Sidepanel
- main UI
- simple tabs (citations / notes / new note)

### Pill
- small, stable, no bloat

### Modal
- focused, readable, not a mini-app

---

## Phase discipline

Build strictly in phases.
Do NOT jump phases.

Each phase must:
1. implement scope only
2. remove drift in that scope
3. prove runtime liveness
4. report truth (not optimism)

---

## Required validation per phase

Must prove:

### Runtime
- worker starts
- listeners registered
- popup ↔ worker works
- sidepanel ↔ worker works
- content ↔ worker works

### Injection
- content script present on page

### Build truth
- manifest paths correct
- loaded file = expected file

### Flow
- at least one real end-to-end action works

If not proven → phase is incomplete.

---

## Drift handling

When found:
- dead code → remove
- ghost modules → remove or isolate
- duplicate logic → collapse
- fallback logic → delete

Never leave “just in case.”

---

## Output requirement (every task)

Return:
1. objective completed
2. files changed
3. why changes were made
4. drift removed
5. runtime validation proof
6. remaining blockers
7. whether worker is alive

---

## Red flags (stop immediately)

- worker inactive
- no listener registration
- content calling backend
- popup/sidepanel owning logic
- fake tier/capability
- manual editor URL
- stale build artifacts
- duplicate entrypoints

---

## Final principle

Small + strict + verifiable > clever + broad
