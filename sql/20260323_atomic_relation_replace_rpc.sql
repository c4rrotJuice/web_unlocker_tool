do $$
declare
  missing_tables text[] := array[]::text[];
begin
  if to_regclass('public.documents') is null then
    missing_tables := array_append(missing_tables, 'public.documents');
  end if;
  if to_regclass('public.notes') is null then
    missing_tables := array_append(missing_tables, 'public.notes');
  end if;
  if to_regclass('public.tags') is null then
    missing_tables := array_append(missing_tables, 'public.tags');
  end if;
  if to_regclass('public.document_tags') is null then
    missing_tables := array_append(missing_tables, 'public.document_tags');
  end if;
  if to_regclass('public.document_citations') is null then
    missing_tables := array_append(missing_tables, 'public.document_citations');
  end if;
  if to_regclass('public.note_tag_links') is null then
    missing_tables := array_append(missing_tables, 'public.note_tag_links');
  end if;
  if to_regclass('public.note_sources') is null then
    missing_tables := array_append(missing_tables, 'public.note_sources');
  end if;
  if to_regclass('public.note_links') is null then
    missing_tables := array_append(missing_tables, 'public.note_links');
  end if;
  if to_regclass('public.citation_instances') is null then
    missing_tables := array_append(missing_tables, 'public.citation_instances');
  end if;

  if cardinality(missing_tables) > 0 then
    raise exception 'Atomic relation RPC migration requires canonical tables: %', array_to_string(missing_tables, ', ');
  end if;
end
$$;


create or replace function public.replace_document_citations_atomic(
  p_user_id uuid,
  p_document_id uuid,
  p_citation_ids uuid[]
)
returns uuid[]
language plpgsql
as $$
declare
  v_applied_ids uuid[] := '{}'::uuid[];
begin
  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
  ) then
    raise exception 'parent_not_found'
      using errcode = 'P0001';
  end if;

  with normalized as (
    select citation_id, min(ord) as ord
    from unnest(coalesce(p_citation_ids, '{}'::uuid[])) with ordinality as input(citation_id, ord)
    group by citation_id
  )
  select coalesce(array_agg(citation_id order by ord), '{}'::uuid[])
  into v_applied_ids
  from normalized;

  if exists (
    with normalized as (
      select citation_id
      from unnest(v_applied_ids) as input(citation_id)
    )
    select 1
    from normalized n
    left join public.citation_instances ci
      on ci.id = n.citation_id
     and ci.user_id = p_user_id
    where ci.id is null
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  delete from public.document_citations
  where user_id = p_user_id
    and document_id = p_document_id;

  insert into public.document_citations (document_id, citation_id, user_id, attached_at)
  select
    p_document_id,
    input.citation_id,
    p_user_id,
    statement_timestamp() + ((input.ord - 1)::text || ' microseconds')::interval
  from unnest(v_applied_ids) with ordinality as input(citation_id, ord);

  return v_applied_ids;
end;
$$;


create or replace function public.replace_document_tags_atomic(
  p_user_id uuid,
  p_document_id uuid,
  p_tag_ids uuid[]
)
returns uuid[]
language plpgsql
as $$
declare
  v_applied_ids uuid[] := '{}'::uuid[];
begin
  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
  ) then
    raise exception 'parent_not_found'
      using errcode = 'P0001';
  end if;

  with normalized as (
    select tag_id, min(ord) as ord
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) with ordinality as input(tag_id, ord)
    group by tag_id
  )
  select coalesce(array_agg(tag_id order by ord), '{}'::uuid[])
  into v_applied_ids
  from normalized;

  if exists (
    with normalized as (
      select tag_id
      from unnest(v_applied_ids) as input(tag_id)
    )
    select 1
    from normalized n
    left join public.tags t
      on t.id = n.tag_id
     and t.user_id = p_user_id
    where t.id is null
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  delete from public.document_tags
  where user_id = p_user_id
    and document_id = p_document_id;

  insert into public.document_tags (document_id, tag_id, user_id, created_at)
  select
    p_document_id,
    input.tag_id,
    p_user_id,
    statement_timestamp() + ((input.ord - 1)::text || ' microseconds')::interval
  from unnest(v_applied_ids) with ordinality as input(tag_id, ord);

  return v_applied_ids;
end;
$$;


create or replace function public.replace_note_tag_links_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_tag_ids uuid[]
)
returns uuid[]
language plpgsql
as $$
declare
  v_applied_ids uuid[] := '{}'::uuid[];
begin
  if not exists (
    select 1
    from public.notes n
    where n.id = p_note_id
      and n.user_id = p_user_id
  ) then
    raise exception 'parent_not_found'
      using errcode = 'P0001';
  end if;

  with normalized as (
    select tag_id, min(ord) as ord
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) with ordinality as input(tag_id, ord)
    group by tag_id
  )
  select coalesce(array_agg(tag_id order by ord), '{}'::uuid[])
  into v_applied_ids
  from normalized;

  if exists (
    with normalized as (
      select tag_id
      from unnest(v_applied_ids) as input(tag_id)
    )
    select 1
    from normalized n
    left join public.tags t
      on t.id = n.tag_id
     and t.user_id = p_user_id
    where t.id is null
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  delete from public.note_tag_links
  where user_id = p_user_id
    and note_id = p_note_id;

  insert into public.note_tag_links (note_id, tag_id, user_id, created_at)
  select
    p_note_id,
    input.tag_id,
    p_user_id,
    statement_timestamp() + ((input.ord - 1)::text || ' microseconds')::interval
  from unnest(v_applied_ids) with ordinality as input(tag_id, ord);

  return v_applied_ids;
end;
$$;


create or replace function public.replace_note_sources_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_sources jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_applied_sources jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_sources_payload'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.notes n
    where n.id = p_note_id
      and n.user_id = p_user_id
  ) then
    raise exception 'parent_not_found'
      using errcode = 'P0001';
  end if;

  with normalized as (
    select
      ord,
      nullif(trim(item->>'url'), '') as url,
      nullif(trim(item->>'title'), '') as title,
      nullif(trim(item->>'hostname'), '') as hostname,
      (item->>'attached_at')::timestamptz as attached_at
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) with ordinality as input(item, ord)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'url', url,
        'title', title,
        'hostname', hostname,
        'attached_at', attached_at
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_applied_sources
  from normalized;

  if exists (
    with normalized as (
      select nullif(trim(item->>'url'), '') as url
      from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as input(item)
    )
    select 1
    from normalized
    where url is null
  ) then
    raise exception 'invalid_sources_payload'
      using errcode = 'P0001';
  end if;

  delete from public.note_sources
  where user_id = p_user_id
    and note_id = p_note_id;

  insert into public.note_sources (note_id, user_id, url, title, hostname, attached_at)
  select
    p_note_id,
    p_user_id,
    nullif(trim(item->>'url'), ''),
    nullif(trim(item->>'title'), ''),
    nullif(trim(item->>'hostname'), ''),
    (item->>'attached_at')::timestamptz
  from jsonb_array_elements(v_applied_sources) as input(item);

  return v_applied_sources;
end;
$$;


create or replace function public.replace_note_links_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_linked_note_ids uuid[]
)
returns uuid[]
language plpgsql
as $$
declare
  v_applied_ids uuid[] := '{}'::uuid[];
  v_count integer := 0;
begin
  if not exists (
    select 1
    from public.notes n
    where n.id = p_note_id
      and n.user_id = p_user_id
  ) then
    raise exception 'parent_not_found'
      using errcode = 'P0001';
  end if;

  with normalized as (
    select linked_note_id, min(ord) as ord
    from unnest(coalesce(p_linked_note_ids, '{}'::uuid[])) with ordinality as input(linked_note_id, ord)
    group by linked_note_id
  )
  select
    coalesce(array_agg(linked_note_id order by ord), '{}'::uuid[]),
    count(*)
  into v_applied_ids, v_count
  from normalized;

  if p_note_id = any(v_applied_ids) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  if exists (
    with normalized as (
      select linked_note_id
      from unnest(v_applied_ids) as input(linked_note_id)
    )
    select 1
    from normalized n
    left join public.notes linked
      on linked.id = n.linked_note_id
     and linked.user_id = p_user_id
    where linked.id is null
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  delete from public.note_links
  where user_id = p_user_id
    and note_id = p_note_id;

  insert into public.note_links (note_id, linked_note_id, user_id, created_at)
  select
    p_note_id,
    input.linked_note_id,
    p_user_id,
    statement_timestamp() + ((v_count - input.ord)::text || ' microseconds')::interval
  from unnest(v_applied_ids) with ordinality as input(linked_note_id, ord);

  return v_applied_ids;
end;
$$;
