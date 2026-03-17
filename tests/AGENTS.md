# Tests AGENTS.md

## Test Philosophy
- Prefer meaningful contract and workflow regression tests over shallow smoke tests.
- Assert response shape, ownership behavior, security behavior, and important side effects where relevant.
- Add regression coverage for any fixed bug that could plausibly return.

## Placement Rules
- Keep module-focused tests near the domain naming convention already used.
- Add cross-surface tests when a change spans backend, editor, extension, shell, or reporting flows.
- Add negative-path tests for auth, redirects, ownership, webhook verification, rate limits, and replay-sensitive flows.

## Quality Rules
- Avoid brittle tests tied to irrelevant implementation details.
- Avoid tests that only assert `200 OK` when payload shape or side effects matter.
- Prefer canonical contract assertions over route-local implementation assumptions.

## Required Coverage Themes
- auth/security/capability derivation
- identity bootstrap and `/api/me`
- research graph CRUD and serializers
- atomic relation replacement
- workspace hydration/checkpoints/export gates
- extension handoff/capture/work-in-editor
- insights/activity/reporting
- editor runtime hydration and seeded flow
- unified feedback runtime where practical

## Completion Gate
A task is not done unless the report includes:
- tests added/updated
- commands run
- pass/fail
- skipped coverage and why
