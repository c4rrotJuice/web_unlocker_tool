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
  perform public.assert_note_owner(p_note_id, p_user_id);

  delete from public.note_sources
  where note_id = p_note_id and user_id = p_user_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    insert into public.note_sources(
      note_id, user_id, url, hostname, title, source_author, source_published_at
    )
    values (
      p_note_id,
      p_user_id,
      coalesce(v_item->>'url', ''),
      nullif(v_item->>'hostname', ''),
      nullif(v_item->>'title', ''),
      nullif(v_item->>'source_author', ''),
      case when nullif(v_item->>'source_published_at', '') is null then null
           else (v_item->>'source_published_at')::timestamptz end
    );
  end loop;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ns.id,
          'url', ns.url,
          'hostname', ns.hostname,
          'title', ns.title,
          'source_author', ns.source_author,
          'source_published_at', ns.source_published_at,
          'attached_at', ns.attached_at
        ) order by ns.attached_at, ns.id
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
  p_linked_note_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_linked_note_ids, '{}'::uuid[]);
begin
  perform public.assert_note_owner(p_note_id, p_user_id);

  if exists (
    select 1
    from unnest(v_ids) as x(id)
    left join public.notes n
      on n.id = x.id and n.user_id = p_user_id
    where n.id is null
  ) then
    raise exception 'one_or_more_linked_notes_not_owned';
  end if;

  if exists (select 1 from unnest(v_ids) as x(id) where x.id = p_note_id) then
    raise exception 'note_cannot_link_to_itself';
  end if;

  delete from public.note_links
  where note_id = p_note_id and user_id = p_user_id;

  insert into public.note_links(note_id, linked_note_id, user_id)
  select p_note_id, x.id, p_user_id
  from unnest(v_ids) as x(id)
  on conflict do nothing;

  return (
    select coalesce(array_agg(linked_note_id order by created_at, linked_note_id), '{}'::uuid[])
    from public.note_links
    where note_id = p_note_id and user_id = p_user_id
  );
end;
$$;

commit;
