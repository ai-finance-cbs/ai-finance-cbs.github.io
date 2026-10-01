-- Deletion shares the owner and group-set locks used by upload completion and grading.
begin;
create function public.delete_submission(p_id uuid) returns text[]
language plpgsql security definer set search_path='' as $$
declare s public.submissions; o record; kind text; due timestamptz; paths text[]; pending_paths text[];
begin
  perform private.assert_writable();
  if private.current_role()<>'student' then raise exception 'Student access required.'; end if;
  select * into s from public.submissions where id=p_id and term_id=private.active_term();
  if not found then raise exception 'Submission unavailable.'; end if;
  select i.kind into kind from public.grade_items i where i.term_id=s.term_id and i.id=s.item_id;
  -- Derive today's owner from the caller; never accept a browser UNI or group.
  select * into o from private.submission_target(s.item_id,kind);
  if s.owner_uni is distinct from o.owner_uni or s.group_id is distinct from o.group_id then
    raise exception 'Submission access required.';
  end if;
  -- Explicitly hold the same advisory lock, then re-read after any concurrent finish.
  perform private.submission_lock(o.term_id,s.item_id,o.owner_uni,o.group_id);
  select * into s from public.submissions where id=p_id and term_id=o.term_id for update;
  if not found then raise exception 'Submission unavailable.'; end if;
  select due_at into due from public.grade_items where term_id=s.term_id and id=s.item_id;
  if due is not null and clock_timestamp()>=due then raise exception 'The deadline has passed. This submission cannot be deleted.'; end if;
  if private.submission_is_graded(s.term_id,s.item_id,s.owner_uni,s.group_id) then raise exception 'Graded, locked.'; end if;

  -- A replacement already in flight must not revive work after deletion commits.
  with cancelled as (
    delete from public.pending_uploads p where p.term_id=s.term_id and p.item_id=s.item_id
      and (p.owner_uni=s.owner_uni or p.group_id=s.group_id) returning p.storage_path
  ) select coalesce(array_agg(storage_path),'{}') into pending_paths from cancelled;
  delete from public.submissions where term_id=s.term_id and id=s.id;
  select coalesce(array_agg(distinct path),'{}') into paths
    from unnest(array[s.storage_path,s.on_time_path] || pending_paths) path
    where path is not null
      and not exists(select 1 from public.submissions x where path in (x.storage_path,x.on_time_path))
      and not exists(select 1 from public.pending_uploads p where p.storage_path=path);
  -- The file service removes these objects. The existing audit trigger keeps the old row.
  return paths;
end $$;
revoke all on function public.delete_submission(uuid) from public,anon,authenticated;
grant execute on function public.delete_submission(uuid) to authenticated;
commit;
