begin;

create or replace function public.assert_document_owner(p_document_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.documents d where d.id = p_document_id and d.user_id = p_user_id
  ) then
    raise exception 'document_not_found_or_not_owned';
  end if;
end;
$$;

create or replace function public.assert_note_owner(p_note_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.notes n where n.id = p_note_id and n.user_id = p_user_id
  ) then
    raise exception 'note_not_found_or_not_owned';
  end if;
end;
$$;

create or replace function public.replace_document_citations_atomic(
  p_user_id uuid,
  p_document_id uuid,
  p_expected_revision timestamptz,
  p_citation_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_citation_ids, '{}'::uuid[]);
begin
  perform public.assert_document_owner(p_document_id, p_user_id);

  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
      and d.updated_at = p_expected_revision
  ) then
    raise exception 'revision_conflict';
  end if;

  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.citation_instances c
      on c.id = x.id and c.user_id = p_user_id
    where c.id is null
  ) then
    raise exception 'one_or_more_citations_not_owned';
  end if;

  delete from public.document_citations
  where document_id = p_document_id and user_id = p_user_id;

  insert into public.document_citations(document_id, citation_id, user_id)
  select p_document_id, x.id, p_user_id
  from unnest(v_ids) as x(id)
  on conflict do nothing;

  update public.documents
  set updated_at = statement_timestamp()
  where id = p_document_id
    and user_id = p_user_id;

  return (
    select coalesce(array_agg(citation_id order by attached_at, citation_id), '{}'::uuid[])
    from public.document_citations
    where document_id = p_document_id and user_id = p_user_id
  );
end;
$$;

create or replace function public.replace_document_tags_atomic(
  p_user_id uuid,
  p_document_id uuid,
  p_expected_revision timestamptz,
  p_tag_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_tag_ids, '{}'::uuid[]);
begin
  perform public.assert_document_owner(p_document_id, p_user_id);

  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
      and d.updated_at = p_expected_revision
  ) then
    raise exception 'revision_conflict';
  end if;

  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.tags t
      on t.id = x.id and t.user_id = p_user_id
    where t.id is null
  ) then
    raise exception 'one_or_more_tags_not_owned';
  end if;

  delete from public.document_tags
  where document_id = p_document_id and user_id = p_user_id;

  insert into public.document_tags(document_id, tag_id, user_id)
  select p_document_id, x.id, p_user_id
  from unnest(v_ids) as x(id)
  on conflict do nothing;

  update public.documents
  set updated_at = statement_timestamp()
  where id = p_document_id
    and user_id = p_user_id;

  return (
    select coalesce(array_agg(tag_id order by created_at, tag_id), '{}'::uuid[])
    from public.document_tags
    where document_id = p_document_id and user_id = p_user_id
  );
end;
$$;

create or replace function public.replace_document_notes_atomic(
  p_user_id uuid,
  p_document_id uuid,
  p_expected_revision timestamptz,
  p_note_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_note_ids, '{}'::uuid[]);
begin
  perform public.assert_document_owner(p_document_id, p_user_id);

  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
      and d.updated_at = p_expected_revision
  ) then
    raise exception 'revision_conflict';
  end if;

  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.notes n
      on n.id = x.id and n.user_id = p_user_id
    where n.id is null
  ) then
    raise exception 'one_or_more_notes_not_owned';
  end if;

  delete from public.document_notes
  where document_id = p_document_id and user_id = p_user_id;

  insert into public.document_notes(document_id, note_id, user_id)
  select p_document_id, x.id, p_user_id
  from unnest(v_ids) as x(id)
  on conflict do nothing;

  update public.documents
  set updated_at = statement_timestamp()
  where id = p_document_id
    and user_id = p_user_id;

  return (
    select coalesce(array_agg(note_id order by attached_at, note_id), '{}'::uuid[])
    from public.document_notes
    where document_id = p_document_id and user_id = p_user_id
  );
end;
$$;

create or replace function public.replace_note_tag_links_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_tag_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_tag_ids, '{}'::uuid[]);
begin
  perform public.assert_note_owner(p_note_id, p_user_id);

  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.tags t
      on t.id = x.id and t.user_id = p_user_id
    where t.id is null
  ) then
    raise exception 'one_or_more_tags_not_owned';
  end if;

  delete from public.note_tag_links
  where note_id = p_note_id and user_id = p_user_id;

  insert into public.note_tag_links(note_id, tag_id, user_id)
  select p_note_id, x.id, p_user_id
  from unnest(v_ids) as x(id)
  on conflict do nothing;

  return (
    select coalesce(array_agg(tag_id order by created_at, tag_id), '{}'::uuid[])
    from public.note_tag_links
    where note_id = p_note_id and user_id = p_user_id
  );
end;
$$;

create or replace function public.replace_note_sources_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_sources_payload';
  end if;

  perform public.assert_note_owner(p_note_id, p_user_id);

  delete from public.note_sources
  where note_id = p_note_id and user_id = p_user_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    insert into public.note_sources(
      note_id, user_id, source_id, citation_id, relation_type, evidence_role, url, hostname, title, source_author, source_published_at, position
    )
    values (
      p_note_id,
      p_user_id,
      case when nullif(v_item->>'source_id', '') is null then null else (v_item->>'source_id')::uuid end,
      case when nullif(v_item->>'citation_id', '') is null then null else (v_item->>'citation_id')::uuid end,
      coalesce(nullif(v_item->>'target_kind', ''), 'external'),
      coalesce(nullif(v_item->>'evidence_role', ''), 'supporting'),
      nullif(v_item->>'url', ''),
      nullif(v_item->>'hostname', ''),
      nullif(v_item->>'title', ''),
      nullif(v_item->>'source_author', ''),
      case when nullif(v_item->>'source_published_at', '') is null then null
           else (v_item->>'source_published_at')::timestamptz end,
      coalesce((v_item->>'position')::integer, 0)
    );
  end loop;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ns.id,
          'target_kind', ns.relation_type,
          'evidence_role', ns.evidence_role,
          'source_id', ns.source_id,
          'citation_id', ns.citation_id,
          'url', ns.url,
          'hostname', ns.hostname,
          'title', ns.title,
          'source_author', ns.source_author,
          'source_published_at', ns.source_published_at,
          'attached_at', ns.attached_at,
          'position', ns.position
        ) order by ns.position, ns.attached_at, ns.id
      ),
      '[]'::jsonb
    )
    from public.note_sources ns
    where ns.note_id = p_note_id and ns.user_id = p_user_id
  );
end;
$$;

create or replace function public.replace_note_links_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_note_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(coalesce(p_note_links, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_note_links_payload';
  end if;

  perform public.assert_note_owner(p_note_id, p_user_id);

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb)) as input(item)
    left join public.notes n
      on n.id = nullif(input.item->>'linked_note_id', '')::uuid and n.user_id = p_user_id
    where n.id is null
      and nullif(input.item->>'linked_note_id', '') is not null
  ) then
    raise exception 'one_or_more_linked_notes_not_owned';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb)) as input(item)
    where coalesce(nullif(input.item->>'link_type', ''), 'related') not in ('supports', 'contradicts', 'extends', 'related')
  ) then
    raise exception 'invalid_note_link_type';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb)) as input(item)
    where nullif(input.item->>'linked_note_id', '')::uuid = p_note_id
  ) then
    raise exception 'note_cannot_link_to_itself';
  end if;

  delete from public.note_links
  where note_id = p_note_id and user_id = p_user_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb))
  loop
    insert into public.note_links(note_id, linked_note_id, user_id, link_type)
    values (
      p_note_id,
      (v_item->>'linked_note_id')::uuid,
      p_user_id,
      coalesce(nullif(v_item->>'link_type', ''), 'related')
    )
    on conflict (note_id, linked_note_id)
    do update set link_type = excluded.link_type;
  end loop;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'linked_note_id', linked_note_id,
          'link_type', link_type,
          'created_at', created_at
        ) order by created_at, linked_note_id
      ),
      '[]'::jsonb
    )
    from public.note_links
    where note_id = p_note_id and user_id = p_user_id
  );
end;
$$;

create or replace function public.get_project_relationship_summaries(
  p_user_id uuid,
  p_project_ids uuid[] default null,
  p_include_archived boolean default true,
  p_limit integer default 24
)
returns table(
  id uuid,
  name text,
  color text,
  description text,
  status text,
  icon text,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  relationship_counts jsonb,
  recent_activity jsonb
)
language sql
security definer
set search_path = public
as $$
  with selected_projects as (
    select p.id, p.name, p.color, p.description, p.status, p.icon, p.archived_at, p.created_at, p.updated_at
    from public.projects p
    where p.user_id = p_user_id
      and (p_include_archived or p.status = 'active')
      and (
        p_project_ids is null
        or cardinality(p_project_ids) = 0
        or p.id = any(p_project_ids)
      )
    order by p.updated_at desc, p.id desc
    limit case
      when p_project_ids is null or cardinality(p_project_ids) = 0 then greatest(coalesce(p_limit, 24), 1)
      else greatest(cardinality(p_project_ids), 1)
    end
  )
  select
    sp.id,
    sp.name,
    sp.color,
    sp.description,
    sp.status,
    sp.icon,
    sp.archived_at,
    sp.created_at,
    sp.updated_at,
    jsonb_build_object(
      'note_count', coalesce(note_counts.note_count, 0),
      'document_count', coalesce(document_counts.document_count, 0),
      'derived_citation_count', coalesce(citation_counts.derived_citation_count, 0),
      'derived_source_count', coalesce(source_counts.derived_source_count, 0)
    ) as relationship_counts,
    coalesce(activity.recent_activity, '[]'::jsonb) as recent_activity
  from selected_projects sp
  left join lateral (
    select count(*)::integer as note_count
    from public.notes n
    where n.user_id = p_user_id
      and n.project_id = sp.id
  ) note_counts on true
  left join lateral (
    select count(*)::integer as document_count
    from public.documents d
    where d.user_id = p_user_id
      and d.project_id = sp.id
  ) document_counts on true
  left join lateral (
    select count(distinct derived_citations.citation_id)::integer as derived_citation_count
    from (
      select n.citation_id
      from public.notes n
      where n.user_id = p_user_id
        and n.project_id = sp.id
        and n.citation_id is not null
      union
      select ns.citation_id
      from public.notes n
      join public.note_sources ns
        on ns.note_id = n.id
       and ns.user_id = p_user_id
      where n.user_id = p_user_id
        and n.project_id = sp.id
        and ns.citation_id is not null
      union
      select dc.citation_id
      from public.documents d
      join public.document_citations dc
        on dc.document_id = d.id
       and dc.user_id = p_user_id
      where d.user_id = p_user_id
        and d.project_id = sp.id
        and dc.citation_id is not null
    ) derived_citations
  ) citation_counts on true
  left join lateral (
    select count(distinct derived_sources.source_id)::integer as derived_source_count
    from (
      select ci.source_id
      from public.notes n
      join public.citation_instances ci
        on ci.id = n.citation_id
       and ci.user_id = p_user_id
      where n.user_id = p_user_id
        and n.project_id = sp.id
        and ci.source_id is not null
      union
      select ns.source_id
      from public.notes n
      join public.note_sources ns
        on ns.note_id = n.id
       and ns.user_id = p_user_id
      where n.user_id = p_user_id
        and n.project_id = sp.id
        and ns.source_id is not null
      union
      select ci.source_id
      from public.documents d
      join public.document_citations dc
        on dc.document_id = d.id
       and dc.user_id = p_user_id
      join public.citation_instances ci
        on ci.id = dc.citation_id
       and ci.user_id = p_user_id
      where d.user_id = p_user_id
        and d.project_id = sp.id
        and ci.source_id is not null
    ) derived_sources
  ) source_counts on true
  left join lateral (
    with recent_entities as (
      select
        'document'::text as entity_type,
        d.id,
        coalesce(nullif(trim(d.title), ''), 'Untitled') as title,
        coalesce(d.status, 'active') as status,
        d.updated_at
      from public.documents d
      where d.user_id = p_user_id
        and d.project_id = sp.id
      union all
      select
        'note'::text as entity_type,
        n.id,
        coalesce(nullif(trim(n.title), ''), 'Untitled note') as title,
        coalesce(n.status, 'active') as status,
        n.updated_at
      from public.notes n
      where n.user_id = p_user_id
        and n.project_id = sp.id
    ),
    limited_recent as (
      select *
      from recent_entities
      order by updated_at desc, id desc
      limit 4
    )
    select jsonb_agg(
      jsonb_build_object(
        'entity_type', limited_recent.entity_type,
        'id', limited_recent.id,
        'title', limited_recent.title,
        'status', limited_recent.status,
        'updated_at', limited_recent.updated_at
      )
      order by limited_recent.updated_at desc, limited_recent.id desc
    ) as recent_activity
    from limited_recent
  ) activity on true
  order by sp.updated_at desc, sp.id desc;
$$;

commit;
