# Migration Apply Checklist

## Preflight

- [ ] Confirm you are deploying against a fresh or canonical v2 database.
- [ ] Confirm no code in the target release depends on dropped schema.
- [ ] Confirm service-role credentials point to the intended Supabase project.
- [ ] Back up the target database or ensure your managed backup window is valid.

## Apply order

Apply SQL in repository order from `sql/`, ending with:

1. `20260321_canonical_research_entities.sql`
2. `20260322_enforce_canonical_runtime_contracts.sql`
3. `20260323_atomic_relation_replace_rpc.sql`
4. `20260324_extend_note_sources_metadata.sql`
5. `20260325_add_billing_webhook_events.sql`

If the environment is new, apply the full ordered set under `sql/` first.

## Post-apply verification

- [ ] canonical billing tables exist
- [ ] `billing_webhook_events` exists
- [ ] canonical research/workspace tables exist
- [ ] atomic relation replacement RPCs exist
- [ ] RLS is enabled on canonical tables
- [ ] app startup succeeds against the migrated database

## Post-apply smoke checks

- [ ] `/healthz`
- [ ] `/api/public-config`
- [ ] signup/bootstrap on a fresh user
- [ ] document create/update/checkpoint
- [ ] citation attach and bibliography generation
- [ ] billing webhook dry run with valid signature fixture
