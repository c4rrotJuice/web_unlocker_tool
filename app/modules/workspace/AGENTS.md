# Workspace Module AGENTS.md

## Module Purpose
This module canonically owns documents, document checkpoints, document hydration, editor access contracts, and document relations to citations, notes, and tags.

## This Module Owns
- `/api/editor/access`
- `/api/docs*`
- document create/read/update/archive/delete/restore
- checkpoint create/list/restore
- document hydration and outline endpoints
- atomic document relation replacement
- canonical document serializer

## This Module Must Not Own
- source/citation creation logic beyond orchestration to research services
- note-domain business logic beyond relation attachment
- auth/session logic
- entitlement truth beyond consuming shared capability helpers

## Implementation Rules
- Document relation truth lives only in relation tables.
- No inline citation arrays or legacy relation blobs.
- Replace-all relation writes must use canonical atomic RPCs.
- Editor-facing read shapes must stay normalized and compact.
- Hydration must support layered editor boot:
  document summary first, attached objects next, explorer/detail later.
- Derived fields like `can_edit` and allowed export formats may be computed in service code, not persisted redundantly.

## Legacy Handling
- Do not restore `documents.citation_ids`.
- Do not tolerate schema-missing fallback behavior.
- Do not recreate ad hoc hydration shapes per route.
- Do not reintroduce monolithic editor-backend coupling.

## Validation Expectations
- document CRUD/archive/restore tests
- checkpoint create/list/restore tests
- replace_document_citations_atomic ownership tests
- replace_document_notes_atomic ownership tests
- replace_document_tags_atomic ownership tests
- hydration shape tests
- outline tests where endpoint exists
- cross-user access denial tests

## Escalation Triggers
Stop if:
- relation writes are being implemented with ad hoc delete/insert sequences where RPCs exist
- editor contract changes would break seeded extension flow or layered hydration
