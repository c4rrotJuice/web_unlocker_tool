alter table public.note_sources
  add column if not exists evidence_role text not null default 'supporting';

alter table public.note_sources
  drop constraint if exists note_sources_evidence_role_check;

alter table public.note_sources
  add constraint note_sources_evidence_role_check
  check (evidence_role in ('primary', 'supporting', 'background'));

alter table public.note_links
  add column if not exists link_type text not null default 'related';

alter table public.note_links
  drop constraint if exists note_links_link_type_check;

alter table public.note_links
  add constraint note_links_link_type_check
  check (link_type in ('supports', 'contradicts', 'extends', 'related'));


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
      coalesce(nullif(trim(item->>'target_kind'), ''), 'external') as target_kind,
      coalesce(nullif(trim(item->>'evidence_role'), ''), 'supporting') as evidence_role,
      nullif(trim(item->>'source_id'), '')::uuid as source_id,
      nullif(trim(item->>'citation_id'), '')::uuid as citation_id,
      nullif(trim(item->>'url'), '') as url,
      nullif(trim(item->>'title'), '') as title,
      nullif(trim(item->>'hostname'), '') as hostname,
      nullif(trim(item->>'source_author'), '') as source_author,
      (item->>'source_published_at')::timestamptz as source_published_at,
      (item->>'attached_at')::timestamptz as attached_at,
      coalesce((item->>'position')::integer, ord - 1) as position
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) with ordinality as input(item, ord)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'target_kind', target_kind,
        'evidence_role', evidence_role,
        'source_id', source_id,
        'citation_id', citation_id,
        'url', url,
        'title', title,
        'hostname', hostname,
        'source_author', source_author,
        'source_published_at', source_published_at,
        'attached_at', attached_at,
        'position', position
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_applied_sources
  from normalized;

  if exists (
    with normalized as (
      select
        coalesce(nullif(trim(item->>'target_kind'), ''), 'external') as target_kind,
        coalesce(nullif(trim(item->>'evidence_role'), ''), 'supporting') as evidence_role,
        nullif(trim(item->>'url'), '') as url,
        nullif(trim(item->>'source_id'), '')::uuid as source_id,
        nullif(trim(item->>'citation_id'), '')::uuid as citation_id
      from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) as input(item)
    )
    select 1
    from normalized
    where target_kind not in ('external', 'source', 'citation')
       or evidence_role not in ('primary', 'supporting', 'background')
       or (target_kind = 'external' and url is null)
       or (target_kind = 'source' and source_id is null)
       or (target_kind = 'citation' and citation_id is null)
  ) then
    raise exception 'invalid_sources_payload'
      using errcode = 'P0001';
  end if;

  if exists (
    with normalized as (
      select
        coalesce(nullif(trim(item->>'target_kind'), ''), 'external') as target_kind,
        nullif(trim(item->>'source_id'), '')::uuid as source_id,
        nullif(trim(item->>'citation_id'), '')::uuid as citation_id
      from jsonb_array_elements(v_applied_sources) as input(item)
    )
    select 1
    from normalized n
    left join public.sources s
      on s.id = n.source_id
    left join public.citation_instances ci
      on ci.id = n.citation_id
     and ci.user_id = p_user_id
    where (n.target_kind = 'source' and s.id is null)
       or (n.target_kind = 'citation' and ci.id is null)
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  delete from public.note_sources
  where user_id = p_user_id
    and note_id = p_note_id;

  insert into public.note_sources (
    note_id,
    user_id,
    source_id,
    citation_id,
    relation_type,
    evidence_role,
    url,
    title,
    hostname,
    source_author,
    source_published_at,
    attached_at,
    position
  )
  select
    p_note_id,
    p_user_id,
    nullif(trim(item->>'source_id'), '')::uuid,
    nullif(trim(item->>'citation_id'), '')::uuid,
    coalesce(nullif(trim(item->>'target_kind'), ''), 'external'),
    coalesce(nullif(trim(item->>'evidence_role'), ''), 'supporting'),
    nullif(trim(item->>'url'), ''),
    nullif(trim(item->>'title'), ''),
    nullif(trim(item->>'hostname'), ''),
    nullif(trim(item->>'source_author'), ''),
    (item->>'source_published_at')::timestamptz,
    (item->>'attached_at')::timestamptz,
    coalesce((item->>'position')::integer, 0)
  from jsonb_array_elements(v_applied_sources) as input(item);

  return v_applied_sources;
end;
$$;


create or replace function public.replace_note_links_atomic(
  p_user_id uuid,
  p_note_id uuid,
  p_note_links jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_applied_links jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_note_links, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_note_links_payload'
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
      linked_note_id,
      link_type,
      min(ord) as ord
    from (
      select
        nullif(trim(item->>'linked_note_id'), '')::uuid as linked_note_id,
        coalesce(nullif(trim(item->>'link_type'), ''), 'related') as link_type,
        ord
      from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb)) with ordinality as input(item, ord)
    ) dedup
    group by linked_note_id, link_type
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'linked_note_id', linked_note_id,
        'link_type', link_type
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_applied_links
  from normalized;

  if exists (
    with normalized as (
      select
        nullif(trim(item->>'linked_note_id'), '')::uuid as linked_note_id,
        coalesce(nullif(trim(item->>'link_type'), ''), 'related') as link_type
      from jsonb_array_elements(coalesce(p_note_links, '[]'::jsonb)) as input(item)
    )
    select 1
    from normalized
    where linked_note_id is null
       or link_type not in ('supports', 'contradicts', 'extends', 'related')
       or linked_note_id = p_note_id
  ) then
    raise exception 'invalid_related_rows'
      using errcode = 'P0001';
  end if;

  if exists (
    with normalized as (
      select nullif(trim(item->>'linked_note_id'), '')::uuid as linked_note_id
      from jsonb_array_elements(v_applied_links) as input(item)
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

  insert into public.note_links (note_id, linked_note_id, user_id, link_type, created_at)
  select
    p_note_id,
    nullif(trim(item->>'linked_note_id'), '')::uuid,
    p_user_id,
    coalesce(nullif(trim(item->>'link_type'), ''), 'related'),
    statement_timestamp() + ((ord - 1)::text || ' microseconds')::interval
  from jsonb_array_elements(v_applied_links) with ordinality as input(item, ord);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'linked_note_id', linked_note_id,
          'link_type', link_type,
          'created_at', created_at
        )
        order by created_at, linked_note_id, link_type
      ),
      '[]'::jsonb
    )
    from public.note_links
    where user_id = p_user_id
      and note_id = p_note_id
  );
end;
$$;


grant execute on function public.replace_note_links_atomic(uuid, uuid, jsonb) to authenticated;
