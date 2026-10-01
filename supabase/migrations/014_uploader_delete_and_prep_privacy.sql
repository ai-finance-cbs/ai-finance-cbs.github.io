-- Limit group deletion to the current uploader and avoid copies of private prep content.
begin;

create or replace function public.delete_submission(p_id uuid) returns text[]
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
  -- Check the uploader again after waiting: a teammate may have replaced this row.
  if s.group_id is not null and s.submitted_by is distinct from private.current_uni() then
    raise exception 'Only the member who uploaded this file can delete it. You can replace it.';
  end if;
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

-- Students need only their own uploader flag, never the uploader's identity.
create or replace function private.submission_snapshot(t text,u text,r text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'submission_items',(select coalesce(jsonb_agg(case when r='student' then
      jsonb_build_object('id',i.id,'term_id',i.term_id,'code',i.code,'title',i.title,'kind',i.kind,'mode',i.mode,
        'group_set_id',i.group_set_id,'due_at',i.due_at,'locked',private.submission_is_graded(t,i.id,
          case when i.mode='individual' then u end,
          (select m.group_id from public.group_memberships m where m.term_id=t and m.set_id=i.group_set_id and m.uni=u)))
      else to_jsonb(i) end order by id),'[]') from public.grade_items i
      where i.term_id=t and (r in ('instructor','grader') or (r='student' and i.kind<>'none'))),
    'submissions',(select coalesce(jsonb_agg((case when r='student' then (to_jsonb(s)-'member_unis'-'submitted_by'-'graded_at')||jsonb_build_object('is_uploader',s.submitted_by=u) else to_jsonb(s) end)||jsonb_build_object('locked',private.submission_is_graded(t,s.item_id,s.owner_uni,s.group_id),'status',case when s.late then 'Late' else 'Submitted' end,
      'membership_changed',case when r in ('instructor','grader') and s.group_id is not null then
        s.member_unis is distinct from (select array_agg(m.uni order by m.uni) from public.group_memberships m join private.term_roster(t) c on c.uni=m.uni where m.term_id=t and m.group_id=s.group_id)
        else false end)),'[]') from public.submissions s where s.term_id=t and (r in ('instructor','grader') or (r='student' and
          (s.owner_uni=u or exists(select 1 from public.group_memberships m where m.term_id=t and m.group_id=s.group_id and m.uni=u)))))
  )
$$;
revoke all on function private.submission_snapshot(text,text,text) from public,anon,authenticated;

-- Keep preview_guard. Preparation notes and speaker details must not enter the audit log.
drop trigger change_audit on public.speakers;
drop trigger change_audit on public.instructor_notes;
commit;
