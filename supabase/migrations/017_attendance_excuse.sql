-- Attendance is quiz-driven. Only instructors can excuse an absence.
-- Existing rows are not rewritten. Migrations 001–016 remain unchanged.
begin;
alter table public.attendance
  add column excuse_reason text check (excuse_reason is null or length(trim(excuse_reason)) between 1 and 300),
  add column excused_at timestamptz,
  add column excused_by text;

-- Keep 008's quiz synchronization. When it updates an excused row, the quiz wins.
-- The existing audit trigger records the old reason before these fields are cleared.
create function private.quiz_clears_excuse() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='excused' and new.source_quiz is not null then
    new.status:='present'; new.manual_override:=false;
  end if;
  if new.status<>'excused' then
    new.excuse_reason:=null; new.excused_at:=null; new.excused_by:=null;
  end if;
  return new;
end $$;
create trigger quiz_clears_excuse before insert or update on public.attendance
  for each row execute function private.quiz_clears_excuse();
revoke all on function private.quiz_clears_excuse() from public,anon,authenticated;

-- The former dropdown and CSV endpoint now accepts only an excuse or its removal.
create or replace function public.save_attendance(p_week integer,entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e record; q integer; reason text; t text:=private.active_term();
begin
  perform private.assert_writable(); perform private.require_instructor();
  if not exists(select 1 from public.attendance_sessions where term_id=t and week=p_week) then raise exception 'Invalid session.'; end if;
  if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>5000 then raise exception 'Invalid attendance rows.'; end if;
  for e in select value v,value->>'uni' uni,value->>'status' status
    from jsonb_array_elements(entries) order by value->>'uni' loop
    if jsonb_typeof(e.v)<>'object' or not (e.v ? 'status') or (e.status is not null and e.status<>'excused') then
      raise exception 'Only excuse or remove excuse is allowed.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(t||':student:'||e.uni,0));
    if not exists(select 1 from private.term_roster(t) r where r.uni=e.uni) then raise exception 'Unknown UNI: %',e.uni; end if;
    select i.quiz_week into q from public.grade_items i join public.grades g on g.term_id=i.term_id and g.item_id=i.id
      where i.term_id=t and g.uni=e.uni and i.quiz_week=p_week;
    if e.status='excused' then
      reason:=trim(e.v->>'excuse_reason');
      if jsonb_typeof(e.v->'excuse_reason') is distinct from 'string' or reason !~ '\S' or length(reason) not between 1 and 300 then
        raise exception 'An excuse reason of 1–300 characters is required.';
      end if;
      if q is not null or exists(select 1 from public.attendance where term_id=t and uni=e.uni and week=p_week and status='present') then
        raise exception 'Present attendance cannot be excused. Correct quiz scores in the Gradebook.';
      end if;
      insert into public.attendance(term_id,uni,week,status,manual_override,excuse_reason,excused_at,excused_by)
        values(t,e.uni,p_week,'excused',true,reason,clock_timestamp(),private.current_email())
        on conflict(term_id,uni,week) do update set status='excused',source_quiz=null,manual_override=true,
          excuse_reason=excluded.excuse_reason,excused_at=excluded.excused_at,excused_by=excluded.excused_by;
    elsif q is not null then
      update public.attendance set status='present',source_quiz=q,manual_override=false,
        excuse_reason=null,excused_at=null,excused_by=null
        where term_id=t and uni=e.uni and week=p_week and status='excused';
    else
      delete from public.attendance where term_id=t and uni=e.uni and week=p_week and status='excused';
    end if;
  end loop;
end $$;
revoke all on function public.save_attendance(integer,jsonb) from public,anon;
grant execute on function public.save_attendance(integer,jsonb) to authenticated;
revoke insert,update,delete,truncate on public.attendance from public,anon,authenticated;
-- attendance_audit and preview_guard stay attached to the table.

-- Add excuse metadata to the staff projection only. Student/preview data stays masked.
create or replace function private.term_snapshot(t text,u text,r text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'term_id',t,
  'sessions',(select coalesce(jsonb_agg(s order by week),'[]') from public.attendance_sessions s where s.term_id=t),
  'attendance',(select coalesce(jsonb_agg(jsonb_build_object('uni',a.uni,'week',a.week,'status',a.status,
    'source_quiz',case when r in ('instructor','grader') or i.released then a.source_quiz else null end,
    'manual_override',case when r in ('instructor','grader') or i.released then a.manual_override else null end) || case when r in ('instructor','grader') then
      jsonb_build_object('excuse_reason',a.excuse_reason,'excused_at',a.excused_at,'excused_by',a.excused_by)
      else '{}'::jsonb end order by a.week),'[]')
    from public.attendance a left join public.grade_items i on i.term_id=a.term_id and i.quiz_week=a.source_quiz
    where a.term_id=t and (r in ('instructor','grader') or (r='student' and a.uni=u))),
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
commit;
