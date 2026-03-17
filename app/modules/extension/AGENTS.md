# Extension Backend Module AGENTS.md

## Module Purpose
This module owns extension-facing backend orchestration only: bootstrap/account snapshot, secure handoff issue/exchange support, capture endpoints, work-in-editor flow, and extension usage-event intake.

## This Module Owns
- `/api/extension/bootstrap`
- `/api/extension/recent-taxonomy`
- extension capture entrypoints for citation/quote/note
- seeded `work-in-editor` backend orchestration
- extension usage-event recording
- extension-safe normalized errors/envelopes

## This Module Must Not Own
- canonical citation business rules
- canonical note business rules
- canonical document business rules
- entitlement truth
- direct duplication of research/workspace service logic

## Implementation Rules
- Orchestrate shared services only.
- Use canonical backend contracts and serializers.
- Capability enforcement comes from shared backend capability state.
- Secure handoff is mandatory for editor/dashboard launches from extension.
- Work-in-editor must preserve canonical lineage:
  source -> citation -> quote -> optional note -> document.
- Normalize all extension responses and errors.

## Legacy Handling
- Do not recreate extension-only shadow entities.
- Do not preserve extension-local policy as authority.
- Preserve the seeded extension-to-editor workflow as a first-class path.
- Preserve required secure `/auth/handoff` termination into canonical web surfaces.

## Validation Expectations
- bootstrap/account snapshot shape tests
- recent taxonomy tests
- citation/quote/note capture contract tests
- work-in-editor flow tests
- one-time handoff and redirect-validation tests
- usage-event dedupe/ownership tests
- no duplicate business logic path assertions where practical

## Escalation Triggers
Stop if:
- extension routes start owning research/workspace logic
- secure handoff conflicts with canonical app destination
- capability state is inferred locally instead of loaded canonically
