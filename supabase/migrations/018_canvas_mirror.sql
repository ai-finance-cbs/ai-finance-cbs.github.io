-- Phase A is a staff-only mirror. Legacy grades, attendance, and student pages stay unchanged.
begin;
create table public.canvas_courses (
  term_id text primary key references public.terms(id),
  course_id bigint not null check(course_id between 1 and 9007199254740991),
  generation uuid, last_synced_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique(term_id,course_id)
);
create table public.canvas_sync_runs (
  id uuid primary key default gen_random_uuid(),
  term_id text not null references public.canvas_courses(term_id),
  course_id bigint not null,
  status text not null check(status in ('running','succeeded','failed','auth_failed','reset')),
  started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  counts jsonb not null default '{}', error text check(length(error)<=500),
  actor_id uuid, actor_email text
);
create unique index canvas_one_running on public.canvas_sync_runs(term_id) where status='running';
create table public.canvas_assignment_map (
  term_id text not null references public.canvas_courses(term_id),
  site_key text not null, canvas_assignment_id bigint not null,
  kind text not null check(kind in ('milestone','final','quiz','optional','participation')),
  week integer check(week between 1 and 6),
  primary key(term_id,site_key), unique(term_id,canvas_assignment_id),
  check((kind='milestone' and site_key ~ '^M[1-5]$' and week is not null and site_key='M'||week)
    or (kind='final' and site_key='FP' and week is not null and week=6)
    or (kind='quiz' and site_key ~ '^Q[1-6]$' and week is not null and site_key='Q'||week)
    or (kind='optional' and site_key ~ '^O[1-9][0-9]?$')
    or (kind='participation' and site_key='PA' and week is null))
);
create table public.canvas_enrollments (
  term_id text not null references public.canvas_courses(term_id), generation uuid not null,
  user_id bigint not null, login_id text, sis_user_id text, name text not null,
  enrollment_states text[] not null, section_ids bigint[] not null,
  uni text, match_status text not null check(match_status in ('matched','unmatched','ambiguous')),
  primary key(term_id,user_id)
);
create table public.canvas_assignments (
  term_id text not null references public.canvas_courses(term_id), generation uuid not null,
  id bigint not null, name text not null, due_at timestamptz, published boolean not null,
  points_possible numeric, group_category_id bigint, submission_types text[] not null,
  only_visible_to_overrides boolean not null,
  primary key(term_id,id)
);
create table public.canvas_submissions (
  term_id text not null references public.canvas_courses(term_id), generation uuid not null,
  assignment_id bigint not null, user_id bigint not null,
  workflow_state text not null check(workflow_state in ('unsubmitted','submitted','graded','pending_review')),
  late boolean not null, missing boolean not null, excused boolean not null,
  late_policy_status text, submitted_at timestamptz, seconds_late integer not null check(seconds_late>=0),
  score numeric, grade text, posted_at timestamptz, cached_due_at timestamptz,
  assignment_visible boolean not null,
  posted_visible boolean generated always as (posted_at is not null and assignment_visible) stored,
  quiz_present boolean generated always as (score is not null and not missing and coalesce(late_policy_status,'')<>'missing') stored,
  primary key(term_id,assignment_id,user_id),
  foreign key(term_id,assignment_id) references public.canvas_assignments(term_id,id),
  foreign key(term_id,user_id) references public.canvas_enrollments(term_id,user_id)
);
create table public.canvas_groups (
  term_id text not null references public.canvas_courses(term_id), generation uuid not null,
  id bigint not null, category_id bigint not null, category_name text not null, name text not null,
  primary key(term_id,id)
);
create table public.canvas_group_members (
  term_id text not null references public.canvas_courses(term_id), generation uuid not null,
  group_id bigint not null, user_id bigint not null, name text not null,
  primary key(term_id,group_id,user_id),
  foreign key(term_id,group_id) references public.canvas_groups(term_id,id)
);

-- No notes, comments, submission bodies, tokens, or file URLs enter this mirror or its audit trail.
do $$ declare t text; begin
  foreach t in array array['canvas_courses','canvas_assignment_map','canvas_enrollments','canvas_assignments','canvas_submissions','canvas_groups','canvas_group_members','canvas_sync_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
    execute format('create policy canvas_staff_read on public.%I for select to authenticated using(private.current_role() in (''instructor'',''grader'') and private.preview_uni() is null and private.can_read_term(term_id))',t);
    execute format('create trigger preview_guard before insert or update or delete on public.%I for each row execute function private.block_preview_write()',t);
    execute format('create trigger change_audit after insert or update or delete on public.%I for each row execute function private.audit_class_change()',t);
  end loop;
end $$;

create function private.canvas_lock(t text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('canvas-sync:'||t,0));
  perform 1 from public.terms where id=t and status='active' for share;
  if not found then raise exception 'Canvas changes require the active term.'; end if;
end $$;
create function public.save_canvas_course(p_term text,p_course bigint,p_confirm_reset boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare previous_course bigint; t text; deleted bigint; cleared jsonb:='{}';
begin
  perform private.require_instructor(); perform private.assert_writable(); perform private.canvas_lock(p_term);
  if p_course is null or p_course not between 1 and 9007199254740991 then raise exception 'Enter a valid Canvas course ID.'; end if;
  update public.canvas_sync_runs set status='failed',finished_at=clock_timestamp(),error='Sync lease expired; previous snapshot retained.'
    where term_id=p_term and status='running' and started_at<clock_timestamp()-interval '10 minutes';
  if exists(select 1 from public.canvas_sync_runs where term_id=p_term and status='running') then raise exception 'Wait for the current sync to finish.'; end if;
  select course_id into previous_course from public.canvas_courses where term_id=p_term;
  if previous_course is not null and previous_course<>p_course then
    if p_confirm_reset is distinct from true then raise exception 'Confirm the Canvas course change before clearing copied data. Reload Settings if the course changed in another tab.'; end if;
    -- Delete children before parents. Audit triggers retain the old copied records.
    foreach t in array array['canvas_submissions','canvas_group_members','canvas_assignment_map','canvas_assignments','canvas_enrollments','canvas_groups'] loop
      execute format('delete from public.%I where term_id=$1',t) using p_term;
      get diagnostics deleted=row_count;
      cleared:=cleared||jsonb_build_object(replace(t,'canvas_',''),deleted);
    end loop;
    update public.canvas_courses set course_id=p_course,generation=null,last_synced_at=null,updated_at=clock_timestamp() where term_id=p_term;
    insert into public.canvas_sync_runs(term_id,course_id,status,finished_at,counts,actor_id,actor_email)
      values(p_term,p_course,'reset',clock_timestamp(),cleared,auth.uid(),private.current_email());
    return;
  end if;
  insert into public.canvas_courses(term_id,course_id) values(p_term,p_course)
    on conflict(term_id) do update set course_id=excluded.course_id,updated_at=clock_timestamp();
end $$;
create function public.save_canvas_mapping(p_term text,p_key text,p_assignment bigint,p_kind text,p_week integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_instructor(); perform private.assert_writable(); perform private.canvas_lock(p_term);
  if p_assignment is null then
    delete from public.canvas_assignment_map where term_id=p_term and site_key=p_key; return;
  end if;
  if not exists(select 1 from public.canvas_assignments a join public.canvas_courses c using(term_id)
    where a.term_id=p_term and a.id=p_assignment and a.generation=c.generation) then raise exception 'Choose an assignment from the latest Canvas sync.'; end if;
  insert into public.canvas_assignment_map(term_id,site_key,canvas_assignment_id,kind,week) values(p_term,p_key,p_assignment,p_kind,p_week)
    on conflict(term_id,site_key) do update set canvas_assignment_id=excluded.canvas_assignment_id,kind=excluded.kind,week=excluded.week;
end $$;

-- REST requests cannot hold a session advisory lock across HTTP fetches. The advisory
-- lock serializes this durable lease; publication checks that the lease still belongs to the run.
create function private.canvas_begin(t text,actor uuid,actor_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.canvas_courses; r public.canvas_sync_runs;
begin
  perform private.canvas_lock(t);
  select * into c from public.canvas_courses where term_id=t;
  if not found then raise exception 'Configure the Canvas course first.'; end if;
  update public.canvas_sync_runs set status='failed',finished_at=clock_timestamp(),error='Sync lease expired; previous snapshot retained.'
    where term_id=t and status='running' and started_at<clock_timestamp()-interval '10 minutes';
  if exists(select 1 from public.canvas_sync_runs where term_id=t and status='running') then raise exception 'A Canvas sync is already running.'; end if;
  insert into public.canvas_sync_runs(term_id,course_id,status,actor_id,actor_email)
    values(t,c.course_id,'running',actor,actor_email) returning * into r;
  return jsonb_build_object('id',r.id,'term_id',t,'course_id',c.course_id);
end $$;
create function public.request_canvas_sync(p_term text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_instructor(); perform private.assert_writable();
  return private.canvas_begin(p_term,auth.uid(),private.current_email());
end $$;
create function public.begin_canvas_sync(p_term text default null) returns jsonb
language sql security definer set search_path='' as $$
  select private.canvas_begin(coalesce(p_term,private.active_term()),null,null)
$$;
create function public.fail_canvas_sync(p_run uuid,p_status text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare t text;
begin
  if p_status not in ('failed','auth_failed') then raise exception 'Invalid sync status.'; end if;
  select term_id into t from public.canvas_sync_runs where id=p_run;
  perform pg_advisory_xact_lock(hashtextextended('canvas-sync:'||t,0));
  update public.canvas_sync_runs set status=p_status,finished_at=clock_timestamp(),error=left(p_error,500)
    where id=p_run and status='running';
end $$;

create function public.publish_canvas_sync(p_run uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.canvas_sync_runs; k text; sync_counts jsonb:='{}';
begin
  select * into r from public.canvas_sync_runs where id=p_run;
  if not found then raise exception 'Sync run not found.'; end if;
  perform private.canvas_lock(r.term_id);
  select * into r from public.canvas_sync_runs where id=p_run for update;
  if r.status='succeeded' then return r.counts; end if;
  if r.status<>'running' or r.started_at<clock_timestamp()-interval '10 minutes'
    or not exists(select 1 from public.canvas_courses where term_id=r.term_id and course_id=r.course_id) then raise exception 'Sync lease is no longer valid.'; end if;
  if r.actor_id is not null and (exists(select 1 from private.student_previews where user_id=r.actor_id)
    or not exists(select 1 from public.allowlist where email=r.actor_email and role='instructor')) then raise exception 'Instructor access changed during sync.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then raise exception 'Invalid Canvas snapshot.'; end if;
  foreach k in array array['enrollments','assignments','submissions','groups','group_members'] loop
    if jsonb_typeof(p_snapshot->k) is distinct from 'array' or jsonb_array_length(p_snapshot->k)>50000 then raise exception 'Incomplete Canvas snapshot: %',k; end if;
    sync_counts:=sync_counts||jsonb_build_object(k,jsonb_array_length(p_snapshot->k));
  end loop;
  insert into public.canvas_enrollments(term_id,generation,user_id,login_id,sis_user_id,name,enrollment_states,section_ids,match_status)
    select r.term_id,p_run,x.user_id,x.login_id,x.sis_user_id,x.name,x.enrollment_states,x.section_ids,'unmatched'
    from jsonb_to_recordset(p_snapshot->'enrollments') as x(user_id bigint, login_id text, sis_user_id text, name text, enrollment_states text[], section_ids bigint[])
    on conflict(term_id,user_id) do update set generation=excluded.generation,
      login_id=excluded.login_id,
      sis_user_id=excluded.sis_user_id,
      name=excluded.name,
      enrollment_states=excluded.enrollment_states,
      section_ids=excluded.section_ids,uni=null,match_status='unmatched';
  insert into public.canvas_assignments(term_id,generation,id,name,due_at,published,points_possible,group_category_id,submission_types,only_visible_to_overrides)
    select r.term_id,p_run,x.id,x.name,x.due_at,x.published,x.points_possible,x.group_category_id,x.submission_types,x.only_visible_to_overrides
    from jsonb_to_recordset(p_snapshot->'assignments') as x(id bigint, name text, due_at timestamptz, published boolean, points_possible numeric, group_category_id bigint, submission_types text[], only_visible_to_overrides boolean)
    on conflict(term_id,id) do update set generation=excluded.generation,
      name=excluded.name,
      due_at=excluded.due_at,
      published=excluded.published,
      points_possible=excluded.points_possible,
      group_category_id=excluded.group_category_id,
      submission_types=excluded.submission_types,
      only_visible_to_overrides=excluded.only_visible_to_overrides;
  insert into public.canvas_submissions(term_id,generation,assignment_id,user_id,workflow_state,late,missing,excused,late_policy_status,submitted_at,seconds_late,score,grade,posted_at,cached_due_at,assignment_visible)
    select r.term_id,p_run,x.assignment_id,x.user_id,x.workflow_state,x.late,x.missing,x.excused,x.late_policy_status,x.submitted_at,x.seconds_late,x.score,x.grade,x.posted_at,x.cached_due_at,x.assignment_visible
    from jsonb_to_recordset(p_snapshot->'submissions') as x(assignment_id bigint, user_id bigint, workflow_state text, late boolean, missing boolean, excused boolean, late_policy_status text, submitted_at timestamptz, seconds_late integer, score numeric, grade text, posted_at timestamptz, cached_due_at timestamptz, assignment_visible boolean)
    on conflict(term_id,assignment_id,user_id) do update set generation=excluded.generation,
      workflow_state=excluded.workflow_state,
      late=excluded.late,
      missing=excluded.missing,
      excused=excluded.excused,
      late_policy_status=excluded.late_policy_status,
      submitted_at=excluded.submitted_at,
      seconds_late=excluded.seconds_late,
      score=excluded.score,
      grade=excluded.grade,
      posted_at=excluded.posted_at,
      cached_due_at=excluded.cached_due_at,
      assignment_visible=excluded.assignment_visible;
  insert into public.canvas_groups(term_id,generation,id,category_id,category_name,name)
    select r.term_id,p_run,x.id,x.category_id,x.category_name,x.name
    from jsonb_to_recordset(p_snapshot->'groups') as x(id bigint, category_id bigint, category_name text, name text)
    on conflict(term_id,id) do update set generation=excluded.generation,
      category_id=excluded.category_id,
      category_name=excluded.category_name,
      name=excluded.name;
  insert into public.canvas_group_members(term_id,generation,group_id,user_id,name)
    select r.term_id,p_run,x.group_id,x.user_id,x.name
    from jsonb_to_recordset(p_snapshot->'group_members') as x(group_id bigint, user_id bigint, name text)
    on conflict(term_id,group_id,user_id) do update set generation=excluded.generation,
      name=excluded.name;
  delete from public.canvas_submissions where term_id=r.term_id and generation<>p_run;
  delete from public.canvas_group_members where term_id=r.term_id and generation<>p_run;
  delete from public.canvas_groups where term_id=r.term_id and generation<>p_run;
  delete from public.canvas_assignments where term_id=r.term_id and generation<>p_run;
  delete from public.canvas_enrollments where term_id=r.term_id and generation<>p_run;
  -- Matching never creates roster rows or verifies a browser's claimed identity.
  update public.canvas_enrollments e set
    uni=case when x.matches=1 and exists(select 1 from private.term_roster(r.term_id) s where s.uni=lower(trim(e.login_id))) then lower(trim(e.login_id)) else null end,
    match_status=case when x.matches>1 then 'ambiguous'
      when exists(select 1 from private.term_roster(r.term_id) s where s.uni=lower(trim(e.login_id))) then 'matched' else 'unmatched' end
    from (select lower(trim(login_id)) login,count(*) matches from public.canvas_enrollments where term_id=r.term_id group by lower(trim(login_id))) x
    where e.term_id=r.term_id and lower(trim(e.login_id))=x.login;
  update public.canvas_courses set generation=p_run,last_synced_at=clock_timestamp() where term_id=r.term_id;
  update public.canvas_sync_runs set status='succeeded',finished_at=clock_timestamp(),counts=sync_counts,error=null where id=p_run;
  return sync_counts;
end $$;

create function public.canvas_staff_data(p_term text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.canvas_courses;
begin
  if private.current_role() not in ('instructor','grader') or private.preview_uni() is not null or not private.can_read_term(p_term) then
    raise exception 'Staff access required.';
  end if;
  select * into c from public.canvas_courses where term_id=p_term;
  return jsonb_build_object('term_id',p_term,'course',case when c.term_id is null then null else to_jsonb(c) end,
    'mappings',(select coalesce(jsonb_agg(m order by site_key),'[]') from public.canvas_assignment_map m where term_id=p_term),
    'enrollments',(select coalesce(jsonb_agg(e order by name,user_id),'[]') from public.canvas_enrollments e where term_id=p_term and generation=c.generation),
    'assignments',(select coalesce(jsonb_agg(a order by name,id),'[]') from public.canvas_assignments a where term_id=p_term and generation=c.generation),
    'submissions',(select coalesce(jsonb_agg(s order by assignment_id,user_id),'[]') from public.canvas_submissions s where term_id=p_term and generation=c.generation),
    'groups',(select coalesce(jsonb_agg(g order by category_id,name),'[]') from public.canvas_groups g where term_id=p_term and generation=c.generation),
    'group_members',(select coalesce(jsonb_agg(m order by group_id,user_id),'[]') from public.canvas_group_members m where term_id=p_term and generation=c.generation),
    'runs',(select coalesce(jsonb_agg(x order by started_at desc),'[]') from (select id,status,started_at,finished_at,counts,error from public.canvas_sync_runs where term_id=p_term order by started_at desc limit 10) x));
end $$;

revoke all on function private.canvas_lock(text),private.canvas_begin(text,uuid,text) from public,anon,authenticated;
revoke all on function public.save_canvas_course(text,bigint,boolean),public.save_canvas_mapping(text,text,bigint,text,integer),public.request_canvas_sync(text),public.canvas_staff_data(text) from public,anon,authenticated;
grant execute on function public.save_canvas_course(text,bigint,boolean),public.save_canvas_mapping(text,text,bigint,text,integer),public.request_canvas_sync(text),public.canvas_staff_data(text) to authenticated;
revoke all on function public.begin_canvas_sync(text),public.publish_canvas_sync(uuid,jsonb),public.fail_canvas_sync(uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_canvas_sync(text),public.publish_canvas_sync(uuid,jsonb),public.fail_canvas_sync(uuid,text,text) to service_role;
commit;
