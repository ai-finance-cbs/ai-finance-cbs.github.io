-- Canvas owns current grades and quiz attendance. Earlier migrations stay unchanged.
begin;

-- Unposted grading decisions are private. Only receipt and deadline facts can set a status.
create or replace function private.canvas_student_status(s jsonb,kind text,at_time timestamptz) returns text
language sql immutable security definer set search_path='' as $$
  select case
    when s is null or not coalesce((s->>'assignment_visible')::boolean,false) then 'Status unavailable'
    when coalesce((s->>'posted_visible')::boolean,false) then case
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
    -- Offline grades have no submission receipt. A graded workflow must not expose an unposted score.
    when jsonb_array_length(coalesce(s->'submission_types','[]'::jsonb))>0
      and (s->'submission_types') <@ '["on_paper","none","external_tool"]'::jsonb
      and (not ((s->'submission_types') ? 'external_tool') or
        (s->>'submitted_at' is null and s->>'workflow_state' not in ('submitted','pending_review'))) then 'Not posted'
    when s->>'submitted_at' is not null or s->>'workflow_state' in ('submitted','pending_review') then case
      when (s->>'submitted_at')::timestamptz>(s->>'cached_due_at')::timestamptz then 'Late' else 'Done' end
    when kind='optional' then 'Optional'
    when s->>'cached_due_at' is null then 'No due date'
    when (s->>'cached_due_at')::timestamptz<=at_time then 'Missing'
    else 'Not yet due' end
$$;

-- Provenance lets a removed quiz mapping clear only Canvas-derived attendance.
alter table public.attendance drop constraint attendance_source_quiz_check;
alter table public.attendance add constraint attendance_source_quiz_check check(source_quiz between 1 and 6);
alter table public.attendance add column canvas_derived boolean not null default false;
create function private.canvas_quiz_present(t text,u text,w integer) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.canvas_assignment_map m
    join public.canvas_submissions s on s.term_id=m.term_id and s.assignment_id=m.canvas_assignment_id
    join public.canvas_enrollments e on e.term_id=s.term_id and e.user_id=s.user_id
    where m.term_id=t and m.kind='quiz' and m.week=w and e.uni=u and e.match_status='matched'
      and e.enrollment_states @> array['active'] and s.quiz_present
      and exists(select 1 from private.term_roster(t) r where r.uni=u))
$$;
create function private.refresh_canvas_attendance(t text) returns void
language plpgsql security definer set search_path='' as $$
declare u text;
begin
  if not exists(select 1 from public.terms where id=t and status='active') then return; end if;
  -- All writers take the Canvas lock before student locks. Keep the student order fixed.
  for u in select uni from private.term_roster(t) union select uni from public.attendance where term_id=t and canvas_derived order by uni loop
    perform pg_advisory_xact_lock(hashtextextended(t||':student:'||u,0));
  end loop;
  insert into public.attendance as old(term_id,uni,week,status,source_quiz,manual_override,canvas_derived)
    select t,r.uni,m.week,'present',m.week,false,true from private.term_roster(t) r
      cross join public.canvas_assignment_map m where m.term_id=t and m.kind='quiz'
      and private.canvas_quiz_present(t,r.uni,m.week)
    on conflict(term_id,uni,week) do update set status='present',source_quiz=excluded.source_quiz,manual_override=false,canvas_derived=true
      where (old.status,old.source_quiz,old.manual_override,old.canvas_derived)
        is distinct from ('present',excluded.source_quiz,false,true);
  -- A quiz that displaced an excuse does not resurrect it when its score disappears (017).
  delete from public.attendance a where a.term_id=t and a.status<>'excused'
    and (a.canvas_derived or (a.source_quiz is not null and exists(select 1 from public.canvas_assignment_map m where m.term_id=t and m.kind='quiz' and m.week=a.week)))
    and not private.canvas_quiz_present(t,a.uni,a.week);
end $$;
create function private.canvas_attendance_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.refresh_canvas_attendance(coalesce(new.term_id,old.term_id));
  return null;
end $$;
-- The generation update is inside publish_canvas_sync, after all snapshot rows are complete.
create trigger canvas_attendance_published after update of generation on public.canvas_courses
  for each row when (old.generation is distinct from new.generation) execute function private.canvas_attendance_changed();
create trigger canvas_attendance_mapping after insert or update or delete on public.canvas_assignment_map
  for each row execute function private.canvas_attendance_changed();

create or replace function public.save_attendance(p_week integer,entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e record; q integer; reason text; t text:=private.active_term();
begin
  perform private.assert_writable(); perform private.require_instructor(); perform private.canvas_lock(t);
  if not exists(select 1 from public.attendance_sessions where term_id=t and week=p_week) then raise exception 'Invalid session.'; end if;
  if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>5000 then raise exception 'Invalid attendance rows.'; end if;
  for e in select value v,value->>'uni' uni,value->>'status' status
    from jsonb_array_elements(entries) order by value->>'uni' loop
    if jsonb_typeof(e.v)<>'object' or not (e.v ? 'status') or (e.status is not null and e.status<>'excused') then
      raise exception 'Only excuse or remove excuse is allowed.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(t||':student:'||e.uni,0));
    if not exists(select 1 from private.term_roster(t) r where r.uni=e.uni) then raise exception 'Unknown UNI: %',e.uni; end if;
    q:=null;
    if exists(select 1 from public.canvas_assignment_map where term_id=t and kind='quiz' and week=p_week) then
      if private.canvas_quiz_present(t,e.uni,p_week) then q:=p_week; end if;
    else
      select i.quiz_week into q from public.grade_items i join public.grades g on g.term_id=i.term_id and g.item_id=i.id
        where i.term_id=t and g.uni=e.uni and i.quiz_week=p_week;
    end if;
    if e.status='excused' then
      reason:=trim(e.v->>'excuse_reason');
      if jsonb_typeof(e.v->'excuse_reason') is distinct from 'string' or reason !~ '\S' or length(reason) not between 1 and 300 then
        raise exception 'An excuse reason of 1–300 characters is required.';
      end if;
      if q is not null or exists(select 1 from public.attendance where term_id=t and uni=e.uni and week=p_week and status='present') then
        raise exception 'Present attendance cannot be excused. Correct quiz scores in CourseWorks.';
      end if;
      insert into public.attendance(term_id,uni,week,status,manual_override,excuse_reason,excused_at,excused_by)
        values(t,e.uni,p_week,'excused',true,reason,clock_timestamp(),private.current_email())
        on conflict(term_id,uni,week) do update set status='excused',source_quiz=null,manual_override=true,
          excuse_reason=excluded.excuse_reason,excused_at=excluded.excused_at,excused_by=excluded.excused_by;
    elsif q is not null then
      update public.attendance set status='present',source_quiz=q,manual_override=false,
        canvas_derived=exists(select 1 from public.canvas_assignment_map where term_id=t and kind='quiz' and week=p_week),
        excuse_reason=null,excused_at=null,excused_by=null
        where term_id=t and uni=e.uni and week=p_week and status='excused';
    else
      delete from public.attendance where term_id=t and uni=e.uni and week=p_week and status='excused';
    end if;
  end loop;
end $$;

-- The raw attendance table stays staff-only. Student projections depend on posting, never row existence.
create function private.canvas_quiz_posted(t text,u text,w integer) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.canvas_assignment_map m
    join public.canvas_assignments a on a.term_id=m.term_id and a.id=m.canvas_assignment_id
    join public.canvas_submissions s on s.term_id=m.term_id and s.assignment_id=m.canvas_assignment_id
    join public.canvas_enrollments e on e.term_id=s.term_id and e.user_id=s.user_id
    where m.term_id=t and m.kind='quiz' and m.week=w and e.uni=u and e.match_status='matched'
      and a.published and s.posted_visible and exists(select 1 from private.term_roster(t) r where r.uni=u)
      and (e.enrollment_states @> array['active'] or
        (exists(select 1 from public.terms where id=t and status='archived-readable') and e.enrollment_states @> array['completed'])))
$$;

create or replace function private.term_snapshot(t text,u text,r text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'term_id',t,
  'sessions',(select coalesce(jsonb_agg(s order by week),'[]') from public.attendance_sessions s where s.term_id=t),
  'attendance',(select coalesce(jsonb_agg(jsonb_build_object('uni',a.uni,'week',a.week,'status',a.status,
    'source_quiz',case when r in ('instructor','grader') or (a.status<>'pending' and case
      when exists(select 1 from public.canvas_assignment_map m where m.term_id=t and m.kind='quiz' and m.week=a.source_quiz)
        then private.canvas_quiz_posted(t,u,a.source_quiz) else i.released end) then a.source_quiz end,
    'manual_override',case when r in ('instructor','grader') or (a.status<>'pending' and case
      when exists(select 1 from public.canvas_assignment_map m where m.term_id=t and m.kind='quiz' and m.week=a.source_quiz)
        then private.canvas_quiz_posted(t,u,a.source_quiz) else i.released end) then a.manual_override end) ||
    case when r in ('instructor','grader') then jsonb_build_object(
      'excuse_reason',a.excuse_reason,'excused_at',a.excused_at,'excused_by',a.excused_by) else '{}'::jsonb end order by a.week),'[]')
    from (
      select a.uni,a.week,case when r='student' and a.status<>'excused'
        and (a.canvas_derived or exists(select 1 from public.canvas_assignment_map m where m.term_id=t and m.kind='quiz' and m.week=a.week))
        and not private.canvas_quiz_posted(t,u,a.week) then 'pending' else a.status end status,
        a.source_quiz,a.manual_override,a.excuse_reason,a.excused_at,a.excused_by
      from public.attendance a where a.term_id=t and (r in ('instructor','grader') or (r='student' and a.uni=u))
      union all
      -- A missing-policy change can remove the row. Return the same Pending shape before and after that change.
      select u,m.week,'pending',null::integer,null::boolean,null::text,null::timestamptz,null::text
      from public.canvas_assignment_map m where r='student' and m.term_id=t and m.kind='quiz'
        and not private.canvas_quiz_posted(t,u,m.week)
        and not exists(select 1 from public.attendance a where a.term_id=t and a.uni=u and a.week=m.week)
    ) a left join public.grade_items i on i.term_id=t and i.quiz_week=a.source_quiz),
  'items',(select coalesce(jsonb_agg(i order by id),'[]') from public.grade_items i where i.term_id=t and (r in ('instructor','grader') or (r='student' and i.released))),
  'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g join public.grade_items i on i.term_id=g.term_id and i.id=g.item_id
    where g.term_id=t and (r in ('instructor','grader') or (r='student' and g.uni=u and i.released))),
  'sets',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('submission_deadline',(select min(i.due_at) from public.grade_items i where i.term_id=t and i.group_set_id=s.id and i.mode='group')) order by created_at),'[]') from public.group_sets s where s.term_id=t and r in ('instructor','grader','student')),
  'groups',(select coalesce(jsonb_agg(g order by number),'[]') from public.class_groups g where g.term_id=t and r in ('instructor','grader','student')),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('set_id',m.set_id,'group_id',m.group_id,
    'uni',case when r in ('instructor','grader') or m.uni=u then m.uni else null end,
    'name',case when r in ('instructor','grader') or exists(select 1 from public.group_memberships mine where mine.term_id=t and mine.uni=u and mine.group_id=m.group_id) then coalesce(nullif(c.name,''),'Student') else null end,
    'email',case when r='instructor' or (r='student' and exists(select 1 from public.group_memberships mine where mine.term_id=t and mine.uni=u and mine.group_id=m.group_id)) then c.email else null end)),'[]')
    from public.group_memberships m join private.term_roster(t) c on c.uni=m.uni where m.term_id=t and r in ('instructor','grader','student')),
  'assignments',(select coalesce(jsonb_agg(a order by id),'[]') from public.assignments a where a.term_id=t and (r in ('instructor','grader','student') or (r='auditor' and a.auditor_visible))),
  'files',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.lecture_files f where f.term_id=t and
    (r in ('instructor','grader') or ((r='student' or (r='auditor' and f.auditor_visible)) and (f.released or f.release_at<=now())))),
  'announcements',(select coalesce(jsonb_agg(a order by created_at desc,id),'[]') from public.announcements a where a.term_id=t and r in ('instructor','grader','student','auditor'))
) || case when r in ('instructor','grader') then jsonb_build_object('roster',
  (select coalesce(jsonb_agg(case when r='grader' then jsonb_build_object('uni',c.uni,'name',c.name) else to_jsonb(c) end order by c.uni),'[]') from private.term_roster(t) c)) else '{}'::jsonb end
$$;

create or replace function public.canvas_student_data(p_term text default null) returns jsonb
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
      'status',case when available and a.published then private.canvas_student_status(to_jsonb(s)||jsonb_build_object('submission_types',a.submission_types),m.kind,now()) else 'Status unavailable' end,
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

revoke all on function private.canvas_student_status(jsonb,text,timestamptz),private.canvas_quiz_present(text,text,integer),private.refresh_canvas_attendance(text),private.canvas_attendance_changed(),private.canvas_quiz_posted(text,text,integer)
  from public,anon,authenticated,service_role;
-- These RPCs only wrote the active term. Archives remain readable, never editable.
revoke all on function public.save_grades(jsonb),public.grade_group(integer,uuid,numeric,text),public.release_grade_item(integer,boolean),public.replace_roster(jsonb)
  from public,anon,authenticated,service_role;
-- Take over already mapped quizzes without waiting for another sync.
select private.refresh_canvas_attendance(private.active_term());
commit;
