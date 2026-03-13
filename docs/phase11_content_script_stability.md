# Phase 11 — Content Script Stability

## Implemented stability model

- Singleton guard moved to `window.WRITIOR_EXTENSION`.
- Lifecycle state tracks:
  - `mounted`
  - `observers`
  - `listeners`
  - `cleanupHandlers`
  - `root`
- Added explicit lifecycle methods:
  - `bootstrap()`
  - `cleanup()`

## Root container

All injected UI now mounts under a single root:
- `#writior-root`

Injected components mounted in root include:
- floating icon
- highlight quick-action pill
- temporary overlays/popups/modals/toasts

## Listener/leak prevention

- Added managed listener registration (`addManagedEventListener`) tracked in lifecycle.
- `cleanup()` removes tracked listeners, disconnects observers, runs cleanup handlers, and removes root.
- Reinjection path now calls prior cleanup before remounting.

## Outcome

Prevents duplicated mounts and reduces listener leaks by making content script initialization deterministic and singleton-safe.
