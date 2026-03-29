begin;

-- Triggers
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger trg_user_entitlements_updated_at
before update on public.user_entitlements
for each row execute function public.set_updated_at();

create trigger trg_billing_customers_updated_at
before update on public.billing_customers
for each row execute function public.set_updated_at();

create trigger trg_billing_subscriptions_updated_at
before update on public.billing_subscriptions
for each row execute function public.set_updated_at();

create trigger trg_guest_unlock_usage_updated_at
before update on public.guest_unlock_usage
for each row execute function public.set_updated_at();

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger trg_tags_updated_at
before update on public.tags
for each row execute function public.set_updated_at();

create trigger trg_sources_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

create trigger trg_citation_instances_updated_at
before update on public.citation_instances
for each row execute function public.set_updated_at();

create trigger trg_citation_templates_updated_at
before update on public.citation_templates
for each row execute function public.set_updated_at();

create trigger trg_quotes_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

create trigger trg_notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

create trigger trg_notes_search_vector_refresh
before insert or update of title, note_body, highlight_text, source_title, source_author
on public.notes
for each row execute function public.notes_search_vector_refresh();

create trigger trg_documents_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.user_profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.auth_handoff_codes enable row level security;
alter table public.unlock_events enable row level security;
alter table public.guest_unlock_usage enable row level security;
alter table public.bookmarks enable row level security;
alter table public.user_milestones enable row level security;
alter table public.projects enable row level security;
alter table public.tags enable row level security;
alter table public.sources enable row level security;
alter table public.citation_instances enable row level security;
alter table public.citation_renders enable row level security;
alter table public.citation_templates enable row level security;
alter table public.quotes enable row level security;
alter table public.notes enable row level security;
alter table public.note_sources enable row level security;
alter table public.note_links enable row level security;
alter table public.note_tag_links enable row level security;
alter table public.documents enable row level security;
alter table public.document_checkpoints enable row level security;
alter table public.document_citations enable row level security;
alter table public.document_notes enable row level security;
alter table public.document_tags enable row level security;

-- Policies
create policy "user_profiles_select_own" on public.user_profiles for select using (auth.uid() = user_id);
create policy "user_profiles_insert_own" on public.user_profiles for insert with check (auth.uid() = user_id);
create policy "user_profiles_update_own" on public.user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_preferences_select_own" on public.user_preferences for select using (auth.uid() = user_id);
create policy "user_preferences_insert_own" on public.user_preferences for insert with check (auth.uid() = user_id);
create policy "user_preferences_update_own" on public.user_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_entitlements_select_own" on public.user_entitlements for select using (auth.uid() = user_id);

create policy "billing_customers_service_role_only" on public.billing_customers
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "billing_subscriptions_service_role_only" on public.billing_subscriptions
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "auth_handoff_codes_select_own" on public.auth_handoff_codes for select using (auth.uid() = user_id);
create policy "auth_handoff_codes_insert_own" on public.auth_handoff_codes for insert with check (auth.uid() = user_id);
create policy "auth_handoff_codes_update_own" on public.auth_handoff_codes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "unlock_events_select_own" on public.unlock_events for select using (auth.uid() = user_id);
create policy "unlock_events_insert_own_or_anon" on public.unlock_events
for insert with check (((user_id is not null) and auth.uid() = user_id) or (user_id is null));

create policy "guest_unlock_usage_service_role_only" on public.guest_unlock_usage
for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "bookmarks_select_own" on public.bookmarks for select using (auth.uid() = user_id);
create policy "bookmarks_insert_own" on public.bookmarks for insert with check (auth.uid() = user_id);
create policy "bookmarks_update_own" on public.bookmarks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bookmarks_delete_own" on public.bookmarks for delete using (auth.uid() = user_id);

create policy "user_milestones_select_own" on public.user_milestones for select using (auth.uid() = user_id);

create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

create policy "tags_select_own" on public.tags for select using (auth.uid() = user_id);
create policy "tags_insert_own" on public.tags for insert with check (auth.uid() = user_id);
create policy "tags_update_own" on public.tags for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tags_delete_own" on public.tags for delete using (auth.uid() = user_id);

create policy "sources_select_authenticated" on public.sources
for select using (auth.uid() is not null or auth.role() = 'service_role');
create policy "sources_service_insert" on public.sources
for insert with check (auth.role() = 'service_role');
create policy "sources_service_update" on public.sources
for update using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "citation_instances_select_own" on public.citation_instances for select using (auth.uid() = user_id);
create policy "citation_instances_insert_own" on public.citation_instances for insert with check (auth.uid() = user_id);
create policy "citation_instances_update_own" on public.citation_instances for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "citation_instances_delete_own" on public.citation_instances for delete using (auth.uid() = user_id);

create policy "citation_renders_select_owned_instances" on public.citation_renders
for select using (exists (select 1 from public.citation_instances ci where ci.id = citation_instance_id and ci.user_id = auth.uid()));
create policy "citation_renders_insert_owned_instances" on public.citation_renders
for insert with check (exists (select 1 from public.citation_instances ci where ci.id = citation_instance_id and ci.user_id = auth.uid()));
create policy "citation_renders_delete_owned_instances" on public.citation_renders
for delete using (exists (select 1 from public.citation_instances ci where ci.id = citation_instance_id and ci.user_id = auth.uid()));

create policy "citation_templates_select_own" on public.citation_templates for select using (auth.uid() = user_id);
create policy "citation_templates_insert_own" on public.citation_templates for insert with check (auth.uid() = user_id);
create policy "citation_templates_update_own" on public.citation_templates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "citation_templates_delete_own" on public.citation_templates for delete using (auth.uid() = user_id);

create policy "quotes_select_own" on public.quotes for select using (auth.uid() = user_id);
create policy "quotes_insert_own" on public.quotes for insert with check (auth.uid() = user_id);
create policy "quotes_update_own" on public.quotes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quotes_delete_own" on public.quotes for delete using (auth.uid() = user_id);

create policy "notes_select_own" on public.notes for select using (auth.uid() = user_id);
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = user_id);

create policy "note_sources_select_own" on public.note_sources for select using (auth.uid() = user_id);
create policy "note_sources_insert_own" on public.note_sources for insert with check (auth.uid() = user_id);
create policy "note_sources_update_own" on public.note_sources for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "note_sources_delete_own" on public.note_sources for delete using (auth.uid() = user_id);

create policy "note_links_select_own" on public.note_links for select using (auth.uid() = user_id);
create policy "note_links_insert_own" on public.note_links for insert with check (auth.uid() = user_id);
create policy "note_links_delete_own" on public.note_links for delete using (auth.uid() = user_id);

create policy "note_tag_links_select_own" on public.note_tag_links for select using (auth.uid() = user_id);
create policy "note_tag_links_insert_own" on public.note_tag_links for insert with check (auth.uid() = user_id);
create policy "note_tag_links_delete_own" on public.note_tag_links for delete using (auth.uid() = user_id);

create policy "documents_select_own" on public.documents for select using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents for insert with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents for delete using (auth.uid() = user_id);

create policy "document_checkpoints_select_own" on public.document_checkpoints for select using (auth.uid() = user_id);
create policy "document_checkpoints_insert_own" on public.document_checkpoints for insert with check (auth.uid() = user_id);
create policy "document_checkpoints_delete_own" on public.document_checkpoints for delete using (auth.uid() = user_id);

create policy "document_citations_select_own" on public.document_citations for select using (auth.uid() = user_id);
create policy "document_citations_insert_own" on public.document_citations for insert with check (auth.uid() = user_id);
create policy "document_citations_delete_own" on public.document_citations for delete using (auth.uid() = user_id);

create policy "document_notes_select_own" on public.document_notes for select using (auth.uid() = user_id);
create policy "document_notes_insert_own" on public.document_notes for insert with check (auth.uid() = user_id);
create policy "document_notes_delete_own" on public.document_notes for delete using (auth.uid() = user_id);

create policy "document_tags_select_own" on public.document_tags for select using (auth.uid() = user_id);
create policy "document_tags_insert_own" on public.document_tags for insert with check (auth.uid() = user_id);
create policy "document_tags_delete_own" on public.document_tags for delete using (auth.uid() = user_id);

grant usage on schema public to authenticated, anon;
grant execute on function public.replace_document_citations_atomic(uuid, uuid, timestamptz, uuid[]) to authenticated;
grant execute on function public.replace_document_tags_atomic(uuid, uuid, timestamptz, uuid[]) to authenticated;
grant execute on function public.replace_document_notes_atomic(uuid, uuid, timestamptz, uuid[]) to authenticated;
grant execute on function public.replace_note_tag_links_atomic(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.replace_note_sources_atomic(uuid, uuid, jsonb) to authenticated;
grant execute on function public.replace_note_links_atomic(uuid, uuid, jsonb) to authenticated;
grant execute on function public.get_project_relationship_summaries(uuid, uuid[], boolean, integer) to authenticated;
grant execute on function public.get_unlock_days(uuid, date, date) to authenticated;
grant execute on function public.get_monthly_domain_counts(uuid, date, date) to authenticated;
grant execute on function public.get_monthly_citation_breakdown(uuid, date, date) to authenticated;
grant execute on function public.bootstrap_new_user(uuid, text, text) to service_role;

commit;
