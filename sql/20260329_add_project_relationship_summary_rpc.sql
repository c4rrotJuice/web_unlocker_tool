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
    select count(distinct ns.source_id)::integer as derived_source_count
    from public.notes n
    join public.note_sources ns
      on ns.note_id = n.id
     and ns.user_id = p_user_id
    where n.user_id = p_user_id
      and n.project_id = sp.id
      and ns.source_id is not null
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
