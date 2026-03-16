Writior v2 migration pack

Run order in Supabase SQL editor:
1. 001_extensions_and_utils.sql
2. 002_accounts_and_billing.sql
3. 003_growth_and_unlocks.sql
4. 004_taxonomy.sql
5. 005_sources_citations_quotes.sql
6. 006_notes.sql
7. 007_documents.sql
8. 008_rpc_functions.sql
9. 009_triggers_rls.sql

Assumptions:
- Existing database objects from the legacy app are gone.
- auth.users already exists (Supabase auth).
- You want a fresh canonical v2 schema with no backward-compatibility tables.

Important:
- The SQL is designed for a clean database.
- If you rerun the files, some CREATE POLICY / CREATE TRIGGER statements will fail unless you drop the existing objects first.
