-- Students read a narrow, verified Canvas projection. Legacy work stays archived.
begin;

create function private.canvas_student_status(s jsonb,kind text,at_time timestamptz) returns text
language sql immutable security definer set search_path='' as $$
  select case
    when s is null or not coalesce((s->>'assignment_visible')::boolean,false) then 'Status unavailable'
    when (s->>'excused')::boolean then 'Excused'
    when kind='optional' and s->>'submitted_at' is null and (s->>'workflow_state'='unsubmitted'
      or (s->>'missing')::boolean or s->>'late_policy_status'='missing') then 'Optional'
    when kind<>'optional' and ((s->>'missing')::boolean or s->>'late_policy_status'='missing') then 'Missing'
    when (s->>'late')::boolean or s->>'late_policy_status'='late' then 'Late'
    when s->>'workflow_state' in ('submitted','pending_review','graded') then 'Done'
    when kind='optional' then 'Optional'
    when s->>'cached_due_at' is null then 'No due date'
    when (s->>'cached_due_at')::timestamptz<=at_time then 'Missing'
    else 'Not yet due' end
$$;

create function public.canvas_student_data(p_term text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t text:=coalesce(p_term,private.current_term()); u text:=private.current_uni();
  c public.canvas_courses; run public.canvas_sync_runs; student_id bigint; available boolean;
begin
  if private.current_role()<>'student' or u is null or not private.can_read_term(t)
    or (private.preview_uni() is not null and t is distinct from private.current_term()) then
    raise exception 'Student access required for this term.';
  end if;
  -- No caller-supplied UNI. Recheck the roster because it can change between syncs.
  select e.user_id into student_id from public.canvas_enrollments e
    where e.term_id=t and e.uni=u and e.match_status='matched'
      and exists(select 1 from private.term_roster(t) r where r.uni=u)
      and (e.enrollment_states @> array['active'] or
        (exists(select 1 from public.terms where id=t and status='archived-readable') and e.enrollment_states @> array['completed']));
  select * into c from public.canvas_courses where term_id=t;
  -- A new in-flight run does not hide a previous failure until it succeeds.
  select * into run from public.canvas_sync_runs where term_id=t and status<>'running'
    order by started_at desc,id desc limit 1;
  available:=student_id is not null and c.generation is not null
    and coalesce(run.status='succeeded',false)
    and not exists(select 1 from public.canvas_sync_runs where term_id=t and status='running'
      and started_at<now()-interval '10 minutes');
  return jsonb_build_object('term_id',t,'last_synced_at',c.last_synced_at,'available',coalesce(available,false),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'site_key',m.site_key,'kind',m.kind,'week',m.week,
      'title',(select i.title from public.grade_items i where i.term_id=t and i.code=m.site_key),
      'status',case when available and a.published then private.canvas_student_status(to_jsonb(s),m.kind,now()) else 'Status unavailable' end,
      'due_at',case when available and a.published and s.assignment_visible then s.cached_due_at end,
      'url',case when student_id is not null and a.published and s.assignment_visible then
        'https://courseworks2.columbia.edu/courses/'||c.course_id||'/assignments/'||a.id end,
      'posted_visible',coalesce(available and a.published and s.posted_visible,false),
      'score',case when available and a.published and s.posted_visible then s.score end,
      'grade',case when available and a.published and s.posted_visible then s.grade end,
      'points_possible',case when available and a.published and s.assignment_visible then a.points_possible end
    ) order by case m.kind when 'milestone' then 0 when 'final' then 1 when 'quiz' then 2 when 'participation' then 3 else 4 end,m.week,m.site_key) from public.canvas_assignment_map m
      left join public.canvas_assignments a on a.term_id=t and a.id=m.canvas_assignment_id
      left join public.canvas_submissions s on s.term_id=t and s.assignment_id=a.id and s.user_id=student_id
      where m.term_id=t),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'category_id',g.category_id,'category_name',g.category_name,'name',g.name,
      'members',(select coalesce(jsonb_agg(jsonb_build_object('name',gm.name) order by gm.name,gm.user_id),'[]')
        from public.canvas_group_members gm where gm.term_id=t and gm.group_id=g.id)
    ) order by g.category_id,g.name,g.id) from public.canvas_groups g where g.term_id=t and available
      and exists(select 1 from public.canvas_group_members mine where mine.term_id=t and mine.group_id=g.id and mine.user_id=student_id)),'[]'::jsonb));
end $$;
revoke all on function private.canvas_student_status(jsonb,text,timestamptz) from public,anon,authenticated;
revoke all on function public.canvas_student_data(text) from public,anon,authenticated;
grant execute on function public.canvas_student_data(text) to authenticated;

-- Stale browser tabs cannot mutate the archived submissions or local groups.
revoke all on function public.begin_submission(integer,text,bigint,text),public.finish_submission(uuid,uuid),
  public.submit_link(integer,text),public.delete_submission(uuid),
  public.create_group_set(text,integer,integer,timestamptz),public.update_group_set(uuid,boolean,timestamptz),
  public.choose_group(uuid,uuid,text),public.set_group_note(uuid,text),public.add_groups(uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.confirm_submission_upload(text,uuid,bigint,text) from public,anon,authenticated,service_role;
drop policy submission_object_insert on storage.objects;
create policy submission_archive_no_insert on storage.objects as restrictive for insert to anon,authenticated
  with check(bucket_id<>'submissions');
-- Existing read policies, files, scores, releases, and attendance are unchanged.
commit;
