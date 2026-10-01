-- Local review only. Apply after 001 and 002; this migration has not been pushed.
begin;

-- Upgrade existing roles and visibility columns without changing applied migrations.
alter table public.allowlist drop constraint allowlist_role_check;
alter table public.allowlist drop constraint keep_owner;
update public.allowlist set role=case role when 'instructor_ta' then 'instructor' when 'observer' then 'auditor' else role end;
alter table public.allowlist add constraint allowlist_role_check check(role in ('instructor','grader','auditor'));
alter table public.allowlist add constraint keep_owner check(email<>'oh@gsb.columbia.edu' or role='instructor');
alter table private.test_accounts drop constraint test_accounts_role_check;
update private.test_accounts set role='auditor' where role='observer';
alter table private.test_accounts add constraint test_accounts_role_check check(role in ('student','auditor'));
alter table public.assignments rename column observer_visible to auditor_visible;
alter table public.lecture_files rename column observer_visible to auditor_visible;


-- Test students get a stable synthetic identity, separate from the real class roster.
alter table private.test_accounts add column uni text unique check (uni ~ '^[a-z]{1,8}[0-9]{1,8}$');
with numbered as (select email, row_number() over(order by email) n from private.test_accounts where role='student')
update private.test_accounts t set uni='test'||n from numbered where t.email=numbered.email;
alter table private.test_accounts enable row level security;
revoke all on private.test_accounts from public, anon, authenticated;
create table private.student_previews (
  user_id uuid primary key references auth.users(id) on delete cascade,
  uni text not null,
  started_at timestamptz not null default now()
);
alter table private.student_previews enable row level security;
revoke all on private.student_previews from public, anon, authenticated;

-- CBS email aliases cannot prove ownership of a self-entered UNI. Only instructors link them.
create table private.student_accounts (
  email text primary key check(email=lower(trim(email)) and email ~ '^[^@[:space:]]+@gsb[.]columbia[.]edu$'),
  uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$')
);
alter table private.student_accounts enable row level security;
revoke all on private.student_accounts from public,anon,authenticated;

-- Preserve the actual role separately. Existing policies keep calling current_role's same OID.
create function private.actor_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare e text:=private.current_email(); r text; u text;
begin
  if e is null then return 'unlisted'; end if;
  select role into r from public.allowlist where email=e;
  if r is not null then return r; end if;
  select role into r from private.test_accounts where email=e;
  if r is not null then return r; end if;
  if e like '%@columbia.edu' then u:=split_part(e,'@',1);
  else select uni into u from private.student_accounts where email=e; end if;
  if exists(select 1 from public.roster where uni=u) then return 'student'; end if;
  return 'unlisted';
end $$;
create function private.preview_uni() returns text
language sql stable security definer set search_path='' as $$
  select uni from private.student_previews where user_id=auth.uid() and private.actor_role()='instructor'
$$;
create or replace function private.current_role() returns text
language sql stable security definer set search_path='' as $$
  select case when private.preview_uni() is not null then 'student' else private.actor_role() end
$$;
create function private.current_uni() returns text
language sql stable security definer set search_path='' as $$
  select coalesce(private.preview_uni(),
    (select uni from private.test_accounts where email=private.current_email()),
    case when private.current_email() like '%@columbia.edu' then split_part(private.current_email(),'@',1)
      else (select uni from private.student_accounts where email=private.current_email()) end)
$$;
create function private.class_roster() returns table(uni text,name text,email text,is_test boolean)
language sql stable security definer set search_path='' as $$
  select r.uni,r.name,r.uni||'@columbia.edu',false from public.roster r
    where not exists(select 1 from public.allowlist a where a.role in ('auditor','grader','instructor')
      and (a.email=r.uni||'@columbia.edu' or exists(select 1 from private.student_accounts p where p.email=a.email and p.uni=r.uni)))
  union all
  select t.uni,'Test student '||t.uni,null::text,true from private.test_accounts t
    where t.role='student' and t.uni is not null and not exists(select 1 from public.roster r where r.uni=t.uni)
$$;
create function private.assert_writable() returns void
language plpgsql security definer set search_path='' as $$
begin
  if private.preview_uni() is not null then raise exception 'Student preview is read-only. Exit preview before making changes.'; end if;
end $$;
create function private.require_instructor() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  if private.current_role()<>'instructor' then raise exception 'Instructor access required.'; end if;
end $$;
create function private.require_grader() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  if private.current_role() not in ('instructor','grader') then raise exception 'Grading access required.'; end if;
end $$;
create function private.block_preview_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create table public.attendance_sessions (
  week integer primary key check(week between 1 and 6), date date
);
insert into public.attendance_sessions(week) select generate_series(1,6);
-- No roster foreign key: replacing the Canvas roster must not erase historical grades/attendance.
create table public.attendance (
  uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  week integer not null references public.attendance_sessions(week),
  status text not null check(status in ('present','absent','excused')),
  source_quiz integer check(source_quiz between 1 and 5), manual_override boolean not null default false,
  primary key(uni,week)
);
create table public.group_sets (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 200),
  max_size integer not null check(max_size between 1 and 100), is_open boolean not null default true,
  deadline timestamptz, created_at timestamptz not null default now()
);
create table public.class_groups (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.group_sets(id) on delete cascade,
  number integer not null check(number between 1 and 100), unique(set_id,number), unique(id,set_id)
);
create table public.group_memberships (
  set_id uuid not null, group_id uuid not null, uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$'),
  primary key(set_id,uni), foreign key(group_id,set_id) references public.class_groups(id,set_id) on delete cascade
);
create index group_members_by_group on public.group_memberships(group_id,set_id);
create table public.grade_items (
  id integer primary key, title text not null, max_points numeric(6,2) not null check(max_points>0),
  optional boolean not null default false, released boolean not null default false,
  quiz_week integer unique check(quiz_week between 1 and 5)
);
insert into public.grade_items(id,title,max_points,optional) values
(1,'Milestone #1',10,false),(2,'Milestone #2',10,false),(3,'Milestone #3',10,false),(4,'Milestone #4',10,false),(5,'Milestone #5',10,false),
(6,'Final Prototype',25,false),(7,'In-class quiz 1',3,false),(8,'In-class quiz 2',3,false),(9,'In-class quiz 3',3,false),(10,'In-class quiz 4',3,false),(11,'In-class quiz 5',3,false),
(12,'Participation and attendance',10,false),(13,'Confidently Wrong',10,true),(14,'Right for the Wrong Reason',10,true),(15,'In the Wild',10,true),(16,'Share Your Setup',5,true);
update public.grade_items set quiz_week=id-6 where id between 7 and 11;
create table public.grades (
  uni text not null check(uni ~ '^[a-z]{1,8}[0-9]{1,8}$'), item_id integer not null references public.grade_items(id),
  score numeric(6,2) not null check(score>=0), primary key(uni,item_id)
);

create index attendance_by_week on public.attendance(week);
create index grades_by_item on public.grades(item_id);

-- All mutations use checked RPCs, not direct table writes.
do $$ declare t text; begin
  foreach t in array array['attendance_sessions','attendance','group_sets','class_groups','group_memberships','grade_items','grades'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create trigger preview_guard before insert or update or delete on public.%I for each row execute function private.block_preview_write()',t);
  end loop;
  foreach t in array array['profiles','roster','allowlist','assignments','lecture_files'] loop
    execute format('create trigger preview_guard before insert or update or delete on public.%I for each row execute function private.block_preview_write()',t);
  end loop;
end $$;
create policy sessions_read on public.attendance_sessions for select to authenticated using(private.current_role() in ('student','instructor','grader'));
create policy attendance_read on public.attendance for select to authenticated using(private.current_role() in ('instructor','grader') or (private.current_role()='student' and uni=private.current_uni()));
create policy sets_read on public.group_sets for select to authenticated using(private.current_role() in ('student','instructor'));
create policy groups_read on public.class_groups for select to authenticated using(private.current_role() in ('student','instructor'));
create policy memberships_read on public.group_memberships for select to authenticated using(private.current_role()='instructor' or (private.current_role()='student' and uni=private.current_uni()));
create policy items_read on public.grade_items for select to authenticated using(private.current_role() in ('instructor','grader') or (private.current_role()='student' and released));
create policy grades_read on public.grades for select to authenticated using(private.current_role() in ('instructor','grader') or (private.current_role()='student' and uni=private.current_uni() and exists(select 1 from public.grade_items i where i.id=item_id and i.released)));
-- Old table policies still use current_role; a preview resolves to Student. Also protect Storage inserts.
create policy storage_preview_guard on storage.objects as restrictive for insert to authenticated with check(private.preview_uni() is null);

create or replace function public.get_access() returns jsonb
language plpgsql security definer set search_path='' as $$
declare e text:=private.current_email(); u text; r text; v text:=private.preview_uni(); n text;
begin
  if e is null then raise exception 'Sign in with a verified Columbia Google account.'; end if;
  if v is null then
    if e like '%@columbia.edu' and split_part(e,'@',1) ~ '^[a-z]{1,8}[0-9]{1,8}$' then u:=split_part(e,'@',1); end if;
    insert into public.profiles(id,email,uni) values(auth.uid(),e,u) on conflict(id) do update set email=excluded.email;
  end if;
  u:=private.current_uni(); r:=private.current_role();
  select name into n from private.class_roster() where uni=v;
  return jsonb_build_object('email',e,'uni',u,'role',r,'actor_role',private.actor_role(),
    'needs_uni',e like '%@gsb.columbia.edu' and u is null and r='unlisted',
    'view_as',case when v is null then null else jsonb_build_object('uni',v,'name',coalesce(n,v)) end);
end $$;
create or replace function public.claim_uni(proposed_uni text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_writable();
  if private.current_role()<>'student' or not exists(select 1 from private.student_accounts where email=private.current_email() and uni=lower(trim(proposed_uni))) then
    raise exception 'Ask the instructor to link your CBS email to your UNI.';
  end if;
  return public.get_access();
end $$;
create function public.link_student_account(p_email text,p_uni text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_instructor();
  if p_uni is null then delete from private.student_accounts where email=lower(trim(p_email)); return; end if;
  if not exists(select 1 from public.roster where uni=lower(trim(p_uni))) then raise exception 'Student not found on roster.'; end if;
  insert into private.student_accounts(email,uni) values(lower(trim(p_email)),lower(trim(p_uni)))
    on conflict(email) do update set uni=excluded.uni;
end $$;
create function public.list_student_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role()<>'instructor' then raise exception 'Instructor access required.'; end if;
  return (select coalesce(jsonb_agg(a order by email),'[]') from private.student_accounts a);
end $$;
create function public.set_student_preview(target_uni text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if private.actor_role()<>'instructor' then raise exception 'Instructor access required.'; end if;
  if target_uni is null then delete from private.student_previews where user_id=auth.uid();
  else
    if not exists(select 1 from private.class_roster() where uni=target_uni) then raise exception 'Student not found.'; end if;
    insert into private.student_previews(user_id,uni) values(auth.uid(),target_uni)
      on conflict(user_id) do update set uni=excluded.uni,started_at=now();
  end if;
  return public.get_access();
end $$;
create function public.set_session_date(p_week integer,p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin perform private.require_instructor(); update public.attendance_sessions set date=p_date where week=p_week;
  if not found then raise exception 'Invalid session.'; end if;
end $$;
create function public.save_attendance(p_week integer,entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e record; q integer;
begin
  perform private.require_grader();
  if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>5000 then raise exception 'Invalid attendance rows.'; end if;
  for e in select * from jsonb_to_recordset(entries) as x(uni text,status text) order by uni loop
    perform pg_advisory_xact_lock(hashtextextended(e.uni,0));
    if not exists(select 1 from private.class_roster() r where r.uni=e.uni) then raise exception 'Unknown UNI: %',e.uni; end if;
    select i.quiz_week into q from public.grade_items i join public.grades g on g.item_id=i.id where g.uni=e.uni and i.quiz_week=p_week;
    if e.status is null then
      delete from public.attendance where uni=e.uni and week=p_week;
      if q is not null then insert into public.attendance(uni,week,status,source_quiz) values(e.uni,p_week,'present',q); end if;
    else insert into public.attendance(uni,week,status,source_quiz,manual_override) values(e.uni,p_week,e.status,q,true)
      on conflict(uni,week) do update set status=excluded.status,source_quiz=excluded.source_quiz,manual_override=true; end if;
  end loop;
end $$;
create function public.save_grades(entries jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare e record; maximum numeric; q integer;
begin
  perform private.require_grader();
  if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>80000 then raise exception 'Invalid grade rows.'; end if;
  for e in select * from jsonb_to_recordset(entries) as x(uni text,item_id integer,score numeric) order by uni,item_id loop
    perform pg_advisory_xact_lock(hashtextextended(e.uni,0));
    if not exists(select 1 from private.class_roster() r where r.uni=e.uni) then raise exception 'Unknown UNI: %',e.uni; end if;
    select max_points,quiz_week into maximum,q from public.grade_items where id=e.item_id;
    if maximum is null or (e.score is not null and (e.score<0 or e.score>maximum or e.score::text in ('NaN','Infinity','-Infinity') or e.score<>round(e.score,2))) then raise exception 'Invalid score for item %.',e.item_id; end if;
    if e.score is null then delete from public.grades where uni=e.uni and item_id=e.item_id;
    else insert into public.grades values(e.uni,e.item_id,e.score) on conflict(uni,item_id) do update set score=excluded.score; end if;
    if q is not null then
      if e.score is null then
        delete from public.attendance where uni=e.uni and week=q and source_quiz=q and not manual_override;
        update public.attendance set source_quiz=null where uni=e.uni and week=q;
      else
        insert into public.attendance(uni,week,status,source_quiz) values(e.uni,q,'present',q)
        on conflict(uni,week) do update set source_quiz=q,
          status=case when public.attendance.manual_override then public.attendance.status else 'present' end;
      end if;
    end if;
  end loop;
end $$;
create function public.release_grade_item(p_item integer,p_released boolean) returns void
language plpgsql security definer set search_path='' as $$
begin perform private.require_instructor(); update public.grade_items set released=p_released where id=p_item;
  if not found then raise exception 'Invalid item.'; end if;
end $$;

create function public.create_group_set(p_title text,p_count integer,p_max integer,p_deadline timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform private.require_instructor();
  if p_count is null or p_count not between 1 and 100 then raise exception 'Choose 1 to 100 groups.'; end if;
  insert into public.group_sets(title,max_size,deadline) values(trim(p_title),p_max,p_deadline) returning id into v_id;
  insert into public.class_groups(set_id,number) select v_id,generate_series(1,p_count);
  return v_id;
end $$;
create function public.update_group_set(p_set uuid,p_open boolean,p_deadline timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin perform private.require_instructor(); update public.group_sets set is_open=p_open,deadline=p_deadline where id=p_set;
  if not found then raise exception 'Group set not found.'; end if;
end $$;
create function public.choose_group(p_set uuid,p_group uuid default null,p_uni text default null) returns void
language plpgsql security definer set search_path='' as $$
declare s public.group_sets; u text; r text:=private.current_role();
begin
  perform private.assert_writable();
  if r not in ('student','instructor') then raise exception 'Class access required.'; end if;
  u:=case when r='instructor' then p_uni else private.current_uni() end;
  if r='student' and p_uni is not null and p_uni is distinct from u then raise exception 'You can only change your own group.'; end if;
  if u is null or not exists(select 1 from private.class_roster() where uni=u) then raise exception 'Student not found.'; end if;
  -- All joins, switches, leaves, moves, and locks serialize on this row.
  -- Count seats only after acquiring the lock. Unique(set_id,uni) enforces one membership.
  select * into s from public.group_sets where id=p_set for update;
  if not found then raise exception 'Group set not found.'; end if;
  if r='student' and (not s.is_open or (s.deadline is not null and clock_timestamp()>=s.deadline)) then raise exception 'Sign-up is closed.'; end if;
  if p_group is null then delete from public.group_memberships where set_id=p_set and uni=u; return; end if;
  if not exists(select 1 from public.class_groups where id=p_group and set_id=p_set) then raise exception 'Group not found in this set.'; end if;
  if exists(select 1 from public.group_memberships where set_id=p_set and uni=u and group_id=p_group) then return; end if;
  if (select count(*) from public.group_memberships m join private.class_roster() r on r.uni=m.uni where m.group_id=p_group)>=s.max_size then raise exception 'This group is full.'; end if;
  insert into public.group_memberships(set_id,group_id,uni) values(p_set,p_group,u)
    on conflict(set_id,uni) do update set group_id=excluded.group_id;
end $$;

-- Shared projection for a real student and the read-only instructor preview.
create function private.student_snapshot(u text) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
  'sessions',(select coalesce(jsonb_agg(s order by week),'[]') from public.attendance_sessions s),
  'attendance',(select coalesce(jsonb_agg(a),'[]') from public.attendance a where uni=u),
  'items',(select coalesce(jsonb_agg(i order by id),'[]') from public.grade_items i where released),
  'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g join public.grade_items i on i.id=g.item_id where g.uni=u and i.released),
  'sets',(select coalesce(jsonb_agg(s order by created_at),'[]') from public.group_sets s),
  'groups',(select coalesce(jsonb_agg(g order by number),'[]') from public.class_groups g),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('set_id',m.set_id,'group_id',m.group_id,'uni',case when m.uni=u then u else null end,'name',case when exists(select 1 from public.group_memberships mine where mine.uni=u and mine.group_id=m.group_id) then coalesce(nullif(r.name,''),'Student') else null end,
    'email',case when exists(select 1 from public.group_memberships mine where mine.set_id=m.set_id and mine.uni=u and mine.group_id=m.group_id) then r.email else null end)),'[]')
    from public.group_memberships m join private.class_roster() r on r.uni=m.uni),
  'assignments',(select coalesce(jsonb_agg(a order by id),'[]') from public.assignments a),
  'files',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.lecture_files f)
)
$$;
create function public.view_as_student(target_uni text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.actor_role()<>'instructor' or private.preview_uni() is distinct from target_uni or target_uni is null then raise exception 'Start the read-only student preview first.'; end if;
  return private.student_snapshot(target_uni);
end $$;
create function public.class_data() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=private.current_role();
begin
  if r='student' then return private.student_snapshot(private.current_uni()); end if;
  if r='grader' then return jsonb_build_object(
    'roster',(select coalesce(jsonb_agg(jsonb_build_object('uni',uni,'name',name) order by uni),'[]') from private.class_roster()),
    'sessions',(select jsonb_agg(s order by week) from public.attendance_sessions s),
    'attendance',(select coalesce(jsonb_agg(a),'[]') from public.attendance a),
    'items',(select jsonb_agg(i order by id) from public.grade_items i),
    'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g)); end if;
  if r<>'instructor' then raise exception 'Class access required.'; end if;
  return jsonb_build_object(
    'roster',(select coalesce(jsonb_agg(x order by uni),'[]') from private.class_roster() x),
    'sessions',(select jsonb_agg(s order by week) from public.attendance_sessions s),
    'attendance',(select coalesce(jsonb_agg(a),'[]') from public.attendance a),
    'items',(select jsonb_agg(i order by id) from public.grade_items i),
    'grades',(select coalesce(jsonb_agg(g),'[]') from public.grades g),
    'sets',(select coalesce(jsonb_agg(s order by created_at),'[]') from public.group_sets s),
    'groups',(select coalesce(jsonb_agg(g order by number),'[]') from public.class_groups g),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('set_id',m.set_id,'group_id',m.group_id,'uni',m.uni,'name',r.name,'email',r.email)),'[]') from public.group_memberships m join private.class_roster() r on r.uni=m.uni)
  );
end $$;
create function public.list_test_accounts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if private.current_role()<>'instructor' then raise exception 'Instructor access required.'; end if;
  return (select coalesce(jsonb_agg(t order by email),'[]') from private.test_accounts t);
end $$;


-- Rebuild earlier policies with the new roles. Column renames alone do not update role literals.
do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('profiles','roster','allowlist','assignments','lecture_files') loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $$;
create policy profile_read on public.profiles for select to authenticated using((id=auth.uid() and private.current_role()<>'unlisted') or private.current_role()='instructor');
create policy roster_read on public.roster for select to authenticated using(private.current_role()='instructor');
create policy allowlist_read on public.allowlist for select to authenticated using(private.current_role()='instructor');
create policy allowlist_insert on public.allowlist for insert to authenticated with check(private.current_role()='instructor');
create policy allowlist_update on public.allowlist for update to authenticated using(private.current_role()='instructor' and email<>'oh@gsb.columbia.edu') with check(private.current_role()='instructor' and email<>'oh@gsb.columbia.edu');
create policy allowlist_delete on public.allowlist for delete to authenticated using(private.current_role()='instructor' and email<>'oh@gsb.columbia.edu');
create policy assignment_read on public.assignments for select to authenticated using(private.current_role() in ('instructor','grader','student') or (private.current_role()='auditor' and auditor_visible));
create policy assignment_insert on public.assignments for insert to authenticated with check(private.current_role()='instructor');
create policy assignment_update on public.assignments for update to authenticated using(private.current_role()='instructor') with check(private.current_role()='instructor');
create policy assignment_delete on public.assignments for delete to authenticated using(private.current_role()='instructor');
create policy lecture_read on public.lecture_files for select to authenticated using(private.current_role() in ('instructor','grader','student') or (private.current_role()='auditor' and auditor_visible));
create policy lecture_insert on public.lecture_files for insert to authenticated with check(private.current_role()='instructor');
create policy lecture_update on public.lecture_files for update to authenticated using(private.current_role()='instructor') with check(private.current_role()='instructor');
create policy lecture_delete on public.lecture_files for delete to authenticated using(private.current_role()='instructor');
drop policy lecture_object_insert on storage.objects;
create policy lecture_object_insert on storage.objects for insert to authenticated with check(bucket_id='lecture-notes' and private.current_role()='instructor');
create or replace function public.replace_roster(rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.require_instructor();
  if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 5000 then raise exception 'Provide 1 to 5000 valid roster rows.'; end if;
  if exists(select 1 from jsonb_to_recordset(rows) as x(uni text,name text) where uni is null or uni !~ '^[a-z]{1,8}[0-9]{1,8}$' or length(coalesce(name,''))>200) then raise exception 'Invalid roster row.'; end if;
  lock table public.roster in exclusive mode;
  delete from public.roster;
  insert into public.roster select uni,coalesce(name,'') from jsonb_to_recordset(rows) as x(uni text,name text);
  get diagnostics n=row_count;
  return n;
end $$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default clock_timestamp(),
  actor_id uuid, actor_email text, table_name text not null, operation text not null,
  old_row jsonb, new_row jsonb
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public,anon,authenticated;
grant select on public.audit_log to authenticated;
create policy audit_read on public.audit_log for select to authenticated using(private.current_role()='instructor');
create function private.audit_class_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(actor_id,actor_email,table_name,operation,old_row,new_row)
  values(auth.uid(),private.current_email(),tg_table_name,tg_op,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end);
  return null;
end $$;
create trigger attendance_audit after insert or update or delete on public.attendance for each row execute function private.audit_class_change();
create trigger grades_audit after insert or update or delete on public.grades for each row execute function private.audit_class_change();
create function private.audit_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Audit records cannot be changed or deleted.'; end $$;
create trigger audit_immutable before update or delete on public.audit_log for each row execute function private.audit_immutable();
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function private.audit_immutable();

-- Defaults grant EXECUTE to PUBLIC, so explicitly close every new function first.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;
grant execute on function private.current_role(),private.current_uni(),private.preview_uni() to authenticated;
revoke all on function public.link_student_account(text,text), public.list_student_accounts(), public.set_student_preview(text), public.set_session_date(integer,date),public.save_attendance(integer,jsonb),public.save_grades(jsonb),public.release_grade_item(integer,boolean),public.create_group_set(text,integer,integer,timestamptz),public.update_group_set(uuid,boolean,timestamptz),public.choose_group(uuid,uuid,text),public.view_as_student(text),public.class_data(),public.list_test_accounts() from public,anon;
grant execute on function public.link_student_account(text,text), public.list_student_accounts(), public.set_student_preview(text), public.set_session_date(integer,date),public.save_attendance(integer,jsonb),public.save_grades(jsonb),public.release_grade_item(integer,boolean),public.create_group_set(text,integer,integer,timestamptz),public.update_group_set(uuid,boolean,timestamptz),public.choose_group(uuid,uuid,text),public.view_as_student(text),public.class_data(),public.list_test_accounts() to authenticated;
commit;
