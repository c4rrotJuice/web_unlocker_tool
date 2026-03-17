# Phase 12 — SPA Navigation Handling

## Objective
Detect SPA route changes and refresh page-scoped logic without losing persistent extension UI.

## Detection strategy implemented

The content script now monitors route changes through multiple channels:

- `history.pushState` patch
- `history.replaceState` patch
- `popstate` listener
- `hashchange` listener
- DOM mutation observer (debounced)
- periodic URL poll (`setInterval`)

All channels converge to `checkRouteChange()` and compare against tracked `currentUrl`.

## On URL change

`onRouteChange(nextUrl, previousUrl)` now:

- updates tracked URL
- resets page-scoped selection state
- clears quick-action pill and transient overlays
- clears last selection state in background (`SET_LAST_SELECTION`)
- keeps persistent UI entrypoint (floating icon) mounted
- updates `document.documentElement.dataset.webUnlockerUrl`

## Lifecycle safety

- SPA observers/listeners are attached in `bootstrap()`.
- `cleanup()` restores original history methods, removes listeners, disconnects observers, and clears timers/debounce state.

## Result

The extension now stays stable on SPA sites, refreshes route-specific state on URL transitions, and preserves persistent UI elements while avoiding duplicated mounts and leaked listeners.
# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.
