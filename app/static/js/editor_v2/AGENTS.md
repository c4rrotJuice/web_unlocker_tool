# Editor Runtime AGENTS.md

## Runtime Rules
- The shared v2 shell and `editor_v2` runtime are authoritative.
- Do not restore deprecated page-local or monolithic runtime systems.
- Keep server-rendered boot payloads minimal.
- Fetch entity data through canonical APIs.
- Preserve explicit state ownership boundaries.
- Avoid UI logic duplication across runtime modules.

## Required Runtime Decomposition
Keep responsibilities split across focused modules such as:
- core state/boot/commands
- document controllers
- research hydration/stores
- action handlers
- UI renderers/adapters
- API clients

## Editor-Specific Rules
- Quill is the composition surface, not product truth.
- Workspace/document/research/context/selection state boundaries must remain explicit.
- Do not reintroduce giant `editor.js` orchestration.
- Hydration must remain layered and compact.
- Attached citations are bibliography truth.
- Quote + citation insertion must auto-attach the citation canonically.
- Inline intelligence must stay subtle, not noisy.

## UX/Interaction Rules
- Preserve the three-panel workspace:
  Research Explorer | Writing Surface | Context Rail
- Context rail modes must stay purposeful.
- Command system should be registry-driven.
- First paint must occur before non-critical rail hydration completes.
- Autosave status must be persistent and calm.
- Use the shared toast/status feedback system; do not invent page-specific feedback silos.

## Validation
- runtime boot/hydration smoke coverage
- autosave debounce/coalescing coverage where practical
- command registry action coverage where practical
- seeded extension review flow coverage
- assertions that runtime does not call legacy endpoints
